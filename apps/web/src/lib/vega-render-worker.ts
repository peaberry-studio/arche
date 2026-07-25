import { Worker } from "node:worker_threads"

import type { Config } from "vega-embed"

import {
  MAX_WORKSPACE_CHART_DATA_BYTES,
  resolveWorkspaceDataPath,
} from "@/lib/vega-data-path"
import type { SanitizedChart } from "@/lib/vega/sanitize-spec"
import {
  decodeWorkspaceFileText,
  isValidWorkspacePath,
  readWorkspaceFile,
} from "@/lib/workspace-file-response"

/**
 * Vega compilation, dataflow and layout are synchronous and can run for many seconds on a
 * spec with a large view product (a wide `repeat`, a deep `facet`). Wrapping that in a
 * timer does nothing: the timer cannot fire while the event loop is blocked. Rendering
 * therefore happens in a worker thread that can actually be terminated.
 *
 * The worker performs no I/O at all. Any workspace files a spec references are read on the
 * main thread, where auth and path validation live, and passed in as content.
 *
 * One worker per chart, run sequentially under the document budget. Batching charts into a
 * shared worker would amortize startup and the vega import, but a single runaway chart
 * would then take its neighbours down with it on terminate — per-chart isolation is what
 * makes the per-chart timeout meaningful. Documents with many figures pay for that.
 *
 * Requires Node >= 22.12: the worker source is ESM evaluated with `eval: true`.
 */
const WORKER_SOURCE = `
import { parentPort, workerData } from 'node:worker_threads'

const vega = await import('vega')
const vegaLite = await import('vega-lite')
const { expressionInterpreter } = await import('vega-interpreter')

function createFileLoader(files) {
  const loader = vega.loader()
  const defaultSanitize = loader.sanitize.bind(loader)
  loader.sanitize = async (uri, options) => {
    const rawUri = String(uri)
    const normalized = rawUri.replace(/[\\u0000-\\u001f\\u007f]/g, '').trim().toLowerCase()
    const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1] ?? null

    if (options?.context === 'href' && scheme && !['http', 'https', 'mailto'].includes(scheme)) {
      throw new Error('Unsupported chart link scheme: ' + scheme)
    }
    if (options?.context === 'image' && !normalized.startsWith('data:image/')) {
      throw new Error('Only inline data images are available during PDF export.')
    }

    return defaultSanitize(rawUri, options)
  }
  loader.http = async (uri) => { throw new Error('Network access is not available to chart specs: ' + uri) }
  loader.file = async (uri) => { throw new Error('File access is not available to chart specs: ' + uri) }
  loader.load = async (uri) => {
    const key = String(uri)
    if (!Object.prototype.hasOwnProperty.call(files, key)) {
      throw new Error('Chart spec referenced a file that is not available: ' + key)
    }
    return files[key]
  }
  return loader
}

try {
  const { spec, config, files } = workerData
  const compiled = vegaLite.compile({ ...spec, config })
  // ast: true makes vega.parse emit expression ASTs. The interpreter cannot evaluate the
  // code-based expressions parse emits by default and silently renders an empty chart.
  const runtime = vega.parse(compiled.spec, {}, { ast: true })
  const view = new vega.View(runtime, {
    renderer: 'none',
    expr: expressionInterpreter,
    loader: createFileLoader(files),
  })
  try {
    const svg = await view.toSVG()
    if (svg.length > 16 * 1024 * 1024) {
      throw new Error('Rendered chart SVG exceeds the 16 MB output limit.')
    }
    parentPort.postMessage({ ok: true, svg })
  } finally {
    view.finalize()
  }
} catch (error) {
  parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) })
}
`

/** Reads a workspace-relative file for a chart \`data.url\`; null when unavailable. */
export type WorkspaceDataReader = (
  path: string,
  signal?: AbortSignal,
) => Promise<string | null>

const MAX_REFERENCED_DATA_FILES = 16
const WORKER_MEMORY_LIMIT_MB = 256

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Chart data loading was cancelled.")
}

/**
 * Builds the canonical WorkspaceDataReader for a workspace. Validation and decoding match
 * every other workspace file route, so a spec cannot reach outside the workspace and a
 * base64-stored file arrives at Vega exactly as the browser's download route serves it.
 * An oversized file throws: the caller degrades that chart to a code block, not the export.
 */
export function createWorkspaceDataReader(slug: string): WorkspaceDataReader {
  return async (dataPath, signal) => {
    if (!isValidWorkspacePath(dataPath)) return null

    const dataResult = await readWorkspaceFile(slug, dataPath, signal)
    if (!dataResult.ok) return null

    const decoded = decodeWorkspaceFileText(dataResult.data)
    if (decoded === null) return null

    if (Buffer.byteLength(decoded, "utf-8") > MAX_WORKSPACE_CHART_DATA_BYTES) {
      throw new Error(
        `Chart data file ${dataPath} exceeds the ${MAX_WORKSPACE_CHART_DATA_BYTES / (1024 * 1024)} MB limit.`,
      )
    }

    return decoded
  }
}

/**
 * Reads the workspace files a spec will fetch. The URL list comes from the sanitizer,
 * which collected them at the one place Vega actually loads data from — re-deriving it
 * here by scanning for `url` keys would also pick up `url` columns inside opaque data
 * rows and `image` mark literals, none of which Vega fetches as data.
 */
async function loadReferencedFiles(
  dataUrls: readonly string[],
  readWorkspaceData?: WorkspaceDataReader,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (dataUrls.length === 0) return {}

  if (!readWorkspaceData) {
    throw new Error("This chart references workspace data, which is unavailable in this context.")
  }
  if (dataUrls.length > MAX_REFERENCED_DATA_FILES) {
    throw new Error(`A chart may reference at most ${MAX_REFERENCED_DATA_FILES} workspace data files.`)
  }

  const files: Record<string, string> = {}
  let totalBytes = 0

  for (const uri of dataUrls) {
    if (signal?.aborted) throw abortReason(signal)

    const path = resolveWorkspaceDataPath(uri)
    if (!path) throw new Error(`Blocked a data URL that escapes the workspace: ${uri}`)

    const content = await readWorkspaceData(path, signal)
    if (signal?.aborted) throw abortReason(signal)
    if (content === null) {
      throw new Error(`Workspace file referenced by a chart spec could not be read: ${path}`)
    }

    totalBytes += Buffer.byteLength(content, "utf-8")
    if (totalBytes > MAX_WORKSPACE_CHART_DATA_BYTES) {
      throw new Error(
        `Chart data files exceed the ${MAX_WORKSPACE_CHART_DATA_BYTES / (1024 * 1024)} MB aggregate limit.`,
      )
    }

    files[uri] = content
  }

  return files
}

export async function renderVegaLiteToSvgInWorker(input: {
  /** The canonical sanitized chart: the spec plus the data URLs its walk collected. */
  chart: SanitizedChart
  config: Config
  timeoutMs: number
  readWorkspaceData?: WorkspaceDataReader
}): Promise<string> {
  // The budget covers reading referenced files too. Those reads happen on the main thread
  // and can be slow or large, so leaving them outside the timeout would let a spec stall
  // the export with a file reference while carrying nothing itself.
  const deadline = Date.now() + input.timeoutMs
  const expired = () =>
    new Error(`Chart rendering exceeded ${Math.round(input.timeoutMs / 1000)}s and was cancelled.`)

  const abortController = new AbortController()
  let loadTimer: ReturnType<typeof setTimeout> | undefined
  const loadTimeout = new Promise<never>((_, reject) => {
    loadTimer = setTimeout(() => {
      const error = expired()
      reject(error)
      abortController.abort(error)
    }, input.timeoutMs)
    loadTimer.unref?.()
  })

  let files: Record<string, string>
  try {
    files = await Promise.race([
      loadReferencedFiles(
        input.chart.dataUrls,
        input.readWorkspaceData,
        abortController.signal,
      ),
      loadTimeout,
    ])
  } finally {
    if (loadTimer) clearTimeout(loadTimer)
  }

  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) throw expired()

  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { spec: input.chart.spec, config: input.config, files },
    // The worker only computes; it has no reason to see the process environment.
    env: {},
    resourceLimits: {
      maxOldGenerationSizeMb: WORKER_MEMORY_LIMIT_MB,
      stackSizeMb: 4,
    },
  })

  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(expired()), remainingMs)

      worker.once("message", (message: { ok: boolean; svg?: string; message?: string }) => {
        clearTimeout(timer)
        if (message.ok && typeof message.svg === "string") resolve(message.svg)
        else reject(new Error(message.message ?? "Chart rendering failed."))
      })

      worker.once("error", (error: Error) => {
        clearTimeout(timer)
        reject(error)
      })

      worker.once("exit", (code: number) => {
        clearTimeout(timer)
        reject(new Error(`Chart rendering worker exited early with code ${code}.`))
      })
    })
  } finally {
    // Terminate unconditionally: on timeout this is what actually stops the work.
    void worker.terminate()
  }
}

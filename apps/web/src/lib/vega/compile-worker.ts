import { runEphemeralWorker } from "@/lib/vega/ephemeral-worker"
import type { ChartSpec } from "@/lib/vega/sanitize-spec"

const COMPILE_TIMEOUT_MS = 3_000
const WORKER_MEMORY_LIMIT_MB = 128

const WORKER_SOURCE = `
import { parentPort, workerData } from 'node:worker_threads'

const vega = await import('vega')
const vegaLite = await import('vega-lite')

const warnings = []
const logger = vega.logger(vega.Warn)
logger.warn = (...args) => {
  warnings.push(args.map((arg) => String(arg)).join(' '))
  return logger
}

try {
  vegaLite.compile(workerData.spec, { logger })
  parentPort.postMessage({ ok: true, warnings })
} catch (error) {
  parentPort.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  })
}
`

type CompileWorkerMessage =
  | { ok: true; warnings: string[] }
  | { ok: false; message: string }

/** Compiles a spec off the main thread and returns Vega-Lite's warnings, or throws its error. */
export async function compileVegaLiteSpecInWorker(spec: ChartSpec): Promise<string[]> {
  const message = await runEphemeralWorker<CompileWorkerMessage>({
    source: WORKER_SOURCE,
    workerData: { spec },
    timeoutMs: COMPILE_TIMEOUT_MS,
    timeoutMessage: "Vega-Lite compilation exceeded 3s and was cancelled.",
    label: "Vega-Lite compilation",
    memoryLimitMb: WORKER_MEMORY_LIMIT_MB,
  })

  if (message.ok) return message.warnings
  throw new Error(message.message)
}

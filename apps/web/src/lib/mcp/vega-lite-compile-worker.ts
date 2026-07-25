import { Worker } from "node:worker_threads"

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

export async function compileVegaLiteSpecInWorker(spec: ChartSpec): Promise<string[]> {
  const worker = new Worker(WORKER_SOURCE, {
    env: {},
    eval: true,
    resourceLimits: {
      maxOldGenerationSizeMb: WORKER_MEMORY_LIMIT_MB,
      stackSizeMb: 4,
    },
    workerData: { spec },
  })

  try {
    return await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Vega-Lite compilation exceeded 3s and was cancelled."))
      }, COMPILE_TIMEOUT_MS)

      worker.once("message", (message: CompileWorkerMessage) => {
        clearTimeout(timer)
        if (message.ok) resolve(message.warnings)
        else reject(new Error(message.message))
      })

      worker.once("error", (error: Error) => {
        clearTimeout(timer)
        reject(error)
      })

      worker.once("exit", (code: number) => {
        clearTimeout(timer)
        reject(new Error(`Vega-Lite compilation worker exited early with code ${code}.`))
      })
    })
  } finally {
    void worker.terminate()
  }
}

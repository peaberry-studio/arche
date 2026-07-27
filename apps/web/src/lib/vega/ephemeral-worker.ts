import { Worker } from "node:worker_threads"

/**
 * Runs an inline-ESM worker to completion and returns its first message.
 *
 * Vega compilation, dataflow and layout are synchronous; a timer on the main thread
 * cannot interrupt them, so bounded work means a thread that can be terminated. Every
 * caller gets the same contract: one message resolves, a timeout / worker error / early
 * exit rejects, and the thread is terminated unconditionally on the way out — on timeout
 * that termination is what actually stops the work.
 *
 * The worker source is ESM evaluated with `eval: true`, which requires Node >= 22.12.
 * On older runtimes the worker fails to start and this rejects with the startup error.
 * Bare imports in the source resolve from node_modules at runtime, so the packages they
 * name must be listed in `serverExternalPackages`.
 */
export async function runEphemeralWorker<Message>(input: {
  source: string
  workerData: unknown
  timeoutMs: number
  timeoutMessage: string
  /** Names the worker in early-exit errors, e.g. "Chart rendering". */
  label: string
  memoryLimitMb: number
}): Promise<Message> {
  const worker = new Worker(input.source, {
    eval: true,
    workerData: input.workerData,
    // The worker only computes; it has no reason to see the process environment.
    env: {},
    resourceLimits: {
      maxOldGenerationSizeMb: input.memoryLimitMb,
      stackSizeMb: 4,
    },
  })

  try {
    return await new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(input.timeoutMessage)), input.timeoutMs)

      worker.once("message", (message: Message) => {
        clearTimeout(timer)
        resolve(message)
      })

      worker.once("error", (error: Error) => {
        clearTimeout(timer)
        reject(error)
      })

      worker.once("exit", (code: number) => {
        clearTimeout(timer)
        reject(new Error(`${input.label} worker exited early with code ${code}.`))
      })
    })
  } finally {
    void worker.terminate()
  }
}

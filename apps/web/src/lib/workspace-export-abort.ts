export class WorkspaceExportTimeoutError extends Error {
  constructor() {
    super("workspace_export_timeout")
    this.name = "WorkspaceExportTimeoutError"
  }
}

export function getWorkspaceExportAbortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error("workspace_export_aborted")
}

export function withWorkspaceExportAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(getWorkspaceExportAbortReason(signal))

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(getWorkspaceExportAbortReason(signal))
    signal.addEventListener("abort", abort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

export function createWorkspaceExportAbortContext(
  requestSignal: AbortSignal,
  timeoutMs: number,
): { dispose: () => void; signal: AbortSignal } {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new WorkspaceExportTimeoutError()),
    timeoutMs,
  )
  const abort = () => controller.abort(requestSignal.reason)
  requestSignal.addEventListener("abort", abort, { once: true })
  if (requestSignal.aborted) abort()

  return {
    dispose: () => {
      clearTimeout(timeout)
      requestSignal.removeEventListener("abort", abort)
    },
    signal: controller.signal,
  }
}

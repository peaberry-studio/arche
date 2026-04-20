export type RuntimeRetryEvent = {
  attempt: number
  previousPort: number
  error: unknown
}

type StartRuntimeWithPortRetriesOptions = {
  preferredPort: number
  maxAttempts: number
  acquirePort: (preferredPort: number, excludedPorts: number[]) => Promise<number>
  start: (port: number) => Promise<void>
  onRetry?: (event: RuntimeRetryEvent) => void
}

export async function startRuntimeWithPortRetries(
  options: StartRuntimeWithPortRetriesOptions,
): Promise<number> {
  const attemptedPorts: number[] = []
  let lastError: unknown = null

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    const preferredPort = attempt === 1 ? options.preferredPort : 0
    const port = await options.acquirePort(preferredPort, attemptedPorts)
    attemptedPorts.push(port)

    try {
      await options.start(port)
      return port
    } catch (error) {
      lastError = error

      if (attempt === options.maxAttempts) {
        break
      }

      options.onRetry?.({
        attempt: attempt + 1,
        previousPort: port,
        error,
      })
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to start the local desktop runtime.')
}

export type RuntimeRetryEvent = {
  attempt: number
  previousPort: number
  error: unknown
}

type StartRuntimeWithPortRetriesOptions = {
  preferredPort: number
  maxAttempts: number
  acquirePort: (preferredPort: number, excludedPorts: number[]) => Promise<number>
  start: (port: number, attempt: number) => Promise<void>
  onRetry?: (event: RuntimeRetryEvent) => void
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export async function startRuntimeWithPortRetries(
  options: StartRuntimeWithPortRetriesOptions,
): Promise<number> {
  const attemptedPorts: number[] = []
  const errors: Error[] = []

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    const preferredPort = attempt === 1 ? options.preferredPort : 0
    const port = await options.acquirePort(preferredPort, attemptedPorts)
    attemptedPorts.push(port)

    try {
      await options.start(port, attempt)
      return port
    } catch (error) {
      const normalizedError = normalizeError(error)
      errors.push(normalizedError)

      if (attempt === options.maxAttempts) {
        break
      }

      options.onRetry?.({
        attempt: attempt + 1,
        previousPort: port,
        error: normalizedError,
      })
    }
  }

  if (errors.length === 1) {
    throw errors[0]
  }

  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      `Failed to start the local desktop runtime after ${String(errors.length)} attempts.`,
    )
  }

  throw new Error('Failed to start the local desktop runtime.')
}

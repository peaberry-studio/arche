const OPENAI_RESPONSES_RETRY_DELAY_MS = 250

const RETRYABLE_FETCH_ERROR_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
])

function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const directCode = (error as Error & { code?: string }).code
  if (directCode && RETRYABLE_FETCH_ERROR_CODES.has(directCode)) {
    return true
  }

  const causeCode = (error as Error & { cause?: { code?: string } }).cause?.code
  return Boolean(causeCode && RETRYABLE_FETCH_ERROR_CODES.has(causeCode))
}

export function getFetchErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }

  const directCode = (error as Error & { code?: string }).code
  if (directCode) {
    return directCode
  }

  const causeCode = (error as Error & { cause?: { code?: string } }).cause?.code
  return causeCode ?? null
}

export async function fetchWithRetry(url: string, init: RequestInit, maxAttempts: number): Promise<Response> {
  let attempt = 1

  while (true) {
    try {
      return await fetch(url, init)
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableFetchError(error)) {
        throw error
      }

      const backoffMs = OPENAI_RESPONSES_RETRY_DELAY_MS * attempt
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
      attempt += 1
    }
  }
}

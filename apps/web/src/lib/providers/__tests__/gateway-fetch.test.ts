import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithRetry, getFetchErrorCode } from '@/lib/providers/gateway-fetch'

describe('provider gateway fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('extracts direct and nested fetch error codes', () => {
    const directError = new Error('socket') as Error & { code: string }
    directError.code = 'UND_ERR_SOCKET'
    const causedError = new Error('timeout', { cause: { code: 'ETIMEDOUT' } })

    expect(getFetchErrorCode(directError)).toBe('UND_ERR_SOCKET')
    expect(getFetchErrorCode(causedError)).toBe('ETIMEDOUT')
    expect(getFetchErrorCode('boom')).toBeNull()
    expect(getFetchErrorCode(new Error('missing'))).toBeNull()
  })

  it('retries retryable fetch errors before returning a response', async () => {
    vi.useFakeTimers()
    const retryableError = new Error('socket') as Error & { code: string }
    retryableError.code = 'ECONNRESET'
    const response = new Response('ok')
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce(response)
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = fetchWithRetry('https://api.example.test/v1/responses', {}, 2)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(250)

    await expect(resultPromise).resolves.toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-retryable errors or exhausted attempts', async () => {
    const retryableError = new Error('socket', { cause: { code: 'EPIPE' } })
    const nonRetryableError = new Error('bad request')
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(nonRetryableError)
      .mockRejectedValueOnce(retryableError)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchWithRetry('https://api.example.test/v1/models', {}, 3)).rejects.toThrow('bad request')
    await expect(fetchWithRetry('https://api.example.test/v1/models', {}, 1)).rejects.toThrow('socket')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

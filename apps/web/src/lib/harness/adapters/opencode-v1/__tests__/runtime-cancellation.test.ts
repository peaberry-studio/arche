import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConfiguredOpencodeClient } from '@/lib/harness/adapters/opencode-v1/client-factory'
import { createOpenCodeV1Runtime } from '@/lib/harness/adapters/opencode-v1/runtime'

const mocks = vi.hoisted(() => ({ client: vi.fn() }))

vi.mock('@/lib/harness/adapters/opencode-v1/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/harness/adapters/opencode-v1/client')>()
  return { ...actual, createInstanceClient: mocks.client }
})
vi.mock('@/lib/harness/adapters/opencode-v1/providers', () => ({ ensureProviderAccessFreshForExecution: vi.fn(), syncProviderAccessForInstance: vi.fn() }))
vi.mock('@/lib/harness/adapters/opencode-v1/events', () => ({ subscribeOpenCodeEvents: vi.fn() }))

describe('runtime cancellation through the real SDK transport', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('aborts an in-flight health transport when the runtime deadline expires', async () => {
    const client = await createConfiguredOpencodeClient({ baseUrl: 'http://runtime', authHeader: 'Basic token' })
    mocks.client.mockResolvedValue(client)
    let transportSignal: AbortSignal | null | undefined
    const transportAbort = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      transportSignal = init?.signal
      const abort = () => {
        transportAbort()
        reject(new DOMException('Aborted', 'AbortError'))
      }
      if (transportSignal?.aborted) abort()
      else transportSignal?.addEventListener('abort', abort, { once: true })
    })))
    vi.useFakeTimers()
    const promise = createOpenCodeV1Runtime('alice').health({ timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(0)
    expect(transportSignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(await promise).toEqual({ ok: false, error: { code: 'healthcheck_timeout' } })
    expect(transportSignal?.aborted).toBe(true)
    expect(transportAbort).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})

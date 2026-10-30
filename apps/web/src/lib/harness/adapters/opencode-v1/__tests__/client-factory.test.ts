import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createConfiguredOpencodeClient } from '@/lib/harness/adapters/opencode-v1/client-factory'

type CreateClientOptions = {
  baseUrl: string
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

const createOpencodeClientMock = vi.hoisted(() => vi.fn((options: CreateClientOptions) => options))

vi.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: (options: CreateClientOptions) => createOpencodeClientMock(options),
}))

function getCapturedOptions(): CreateClientOptions {
  const options = createOpencodeClientMock.mock.calls[0]?.[0]
  if (!options) {
    throw new Error('Expected createOpencodeClient to be called')
  }

  return options
}

function expectHeaders(headers: HeadersInit | undefined): Headers {
  if (!(headers instanceof Headers)) {
    throw new Error('Expected Headers instance')
  }

  return headers
}

describe('createConfiguredOpencodeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates an SDK client with the configured base URL', async () => {
    await createConfiguredOpencodeClient({
      authHeader: 'Basic secret',
      baseUrl: 'http://opencode-alice:4096',
    })

    expect(createOpencodeClientMock).toHaveBeenCalledWith({
      baseUrl: 'http://opencode-alice:4096',
      fetch: expect.any(Function),
    })
  })

  it('injects authorization while preserving init method, headers, and body', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await createConfiguredOpencodeClient({ authHeader: 'Basic secret', baseUrl: 'http://opencode' })

    await getCapturedOptions().fetch('http://opencode/session', {
      body: 'payload',
      headers: { 'x-trace': 'trace-1' },
      method: 'POST',
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = expectHeaders(init?.headers)
    expect(init).toMatchObject({
      body: 'payload',
      method: 'POST',
    })
    expect(headers.get('authorization')).toBe('Basic secret')
    expect(headers.get('x-trace')).toBe('trace-1')
  })

  it('preserves Request objects when the SDK passes one as input', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await createConfiguredOpencodeClient({ authHeader: 'Bearer token', baseUrl: 'http://opencode' })
    const request = new Request('http://opencode/session/message', {
      body: 'hello',
      headers: { 'content-type': 'text/plain' },
      method: 'POST',
    })

    await getCapturedOptions().fetch(request)

    const [url, init] = fetchMock.mock.calls[0]
    const headers = expectHeaders(init?.headers)
    expect(url).toBe('http://opencode/session/message')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(request.body)
    expect(init?.signal).toBe(request.signal)
    expect(headers.get('authorization')).toBe('Bearer token')
    expect(headers.get('content-type')).toBe('text/plain')
  })

  it('logs and rethrows fetch failures', async () => {
    const error = new Error('network down')
    vi.stubGlobal('fetch', vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValue(error))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await createConfiguredOpencodeClient({ authHeader: 'Basic secret', baseUrl: 'http://opencode' })

    await expect(getCapturedOptions().fetch('http://opencode/global/health')).rejects.toThrow('network down')
    expect(consoleSpy).toHaveBeenCalledWith('[opencode/client] Fetch error:', error)
  })

  it('propagates native Request cancellation to the reconstructed fetch', async () => {
    const controller = new AbortController()
    const transportAbort = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        transportAbort()
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })))
    await createConfiguredOpencodeClient({ authHeader: 'Basic secret', baseUrl: 'http://opencode' })
    const request = new Request('http://opencode/global/health', { signal: controller.signal })
    const promise = getCapturedOptions().fetch(request)
    const expectation = expect(promise).rejects.toThrow('Aborted')
    controller.abort()
    await expectation
    expect(transportAbort).toHaveBeenCalledOnce()
  })

  it('bounds archive requests by the export deadline as well as request cancellation', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await createConfiguredOpencodeClient({ authHeader: 'Basic fixture', baseUrl: 'http://archive', signal: controller.signal })
    const request = new Request('http://archive/session')
    await getCapturedOptions().fetch(request)
    const signal = fetchMock.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)
    controller.abort()
    expect(signal?.aborted).toBe(true)
  })
})

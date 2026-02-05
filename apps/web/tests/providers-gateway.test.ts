import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockVerifyGatewayToken = vi.fn()
vi.mock('@/lib/providers/tokens', () => ({
  verifyGatewayToken: (...args: unknown[]) => mockVerifyGatewayToken(...args),
}))

const mockGetActiveCredentialForUser = vi.fn()
vi.mock('@/lib/providers/store', () => ({
  getActiveCredentialForUser: (...args: unknown[]) => mockGetActiveCredentialForUser(...args),
}))

const mockDecryptProviderSecret = vi.fn()
vi.mock('@/lib/providers/crypto', () => ({
  decryptProviderSecret: (...args: unknown[]) => mockDecryptProviderSecret(...args),
}))

type ProxyCallInput = {
  provider?: string
  path?: string[]
  method?: string
  headers?: Record<string, string>
  body?: string
  query?: string
}

async function callProxy({
  provider = 'openai',
  path = ['v1', 'chat', 'completions'],
  method = 'POST',
  headers = {},
  body,
  query = 'foo=bar',
}: ProxyCallInput = {}) {
  const { POST, GET, PUT, PATCH, DELETE } = await import(
    '@/app/api/internal/providers/[provider]/[...path]/route'
  )
  const handler =
    method === 'GET'
      ? GET
      : method === 'PUT'
        ? PUT
        : method === 'PATCH'
          ? PATCH
          : method === 'DELETE'
            ? DELETE
            : POST

  const url = `http://localhost/api/internal/providers/${provider}/${path.join('/')}${
    query ? `?${query}` : ''
  }`
  const request = new Request(url, {
    method,
    headers,
    body,
  })

  const response = await handler(request as never, {
    params: Promise.resolve({ provider, path }),
  })

  return response
}

describe('providers gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())

    mockVerifyGatewayToken.mockReturnValue({
      userId: 'user-1',
      workspaceSlug: 'ws',
      providerId: 'openai',
      version: 1,
      exp: Math.floor(Date.now() / 1000) + 1000,
    })
  })

  it('rejects invalid provider', async () => {
    const response = await callProxy({ provider: 'invalid' })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('invalid_provider')
    expect(mockVerifyGatewayToken).not.toHaveBeenCalled()
  })

  it('rejects missing token', async () => {
    const response = await callProxy({ provider: 'openai' })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthorized')
    expect(mockVerifyGatewayToken).not.toHaveBeenCalled()
  })

  it('rejects invalid token', async () => {
    mockVerifyGatewayToken.mockImplementation(() => {
      throw new Error('invalid_token')
    })

    const response = await callProxy({
      provider: 'openai',
      headers: { Authorization: 'Bearer bad-token' },
    })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('invalid_token')
  })

  it('rejects when credential is missing', async () => {
    mockGetActiveCredentialForUser.mockResolvedValue(null)

    const response = await callProxy({
      provider: 'openai',
      headers: { Authorization: 'Bearer token-1' },
    })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('unauthorized')
  })

  it('proxies to OpenAI with real api key', async () => {
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-1',
      type: 'api',
      secret: 'encrypted',
      version: 1,
    })
    mockDecryptProviderSecret.mockReturnValue({ apiKey: 'sk-real' })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'application/json' } })
    )

    const response = await callProxy({
      provider: 'openai',
      headers: {
        Authorization: 'Bearer internal-token',
        'accept-encoding': 'gzip',
        'x-custom': 'preserve-me',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: 'hello' }),
    })

    const text = await response.text()
    expect(text).toBe('ok')
    expect(response.status).toBe(200)

    const [url, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions?foo=bar')
    const headers = options.headers as Headers
    expect(headers.get('authorization')).toBe('Bearer sk-real')
    expect(headers.get('x-custom')).toBe('preserve-me')
    expect(headers.get('accept-encoding')).toBe('identity')
  })

  it('strips content-encoding/content-length from upstream response', async () => {
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-1',
      type: 'api',
      secret: 'encrypted',
      version: 1,
    })
    mockDecryptProviderSecret.mockReturnValue({ apiKey: 'sk-real' })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': '123',
        },
      })
    )

    const response = await callProxy({
      provider: 'openai',
      method: 'GET',
      path: ['v1', 'models'],
      headers: {
        Authorization: 'Bearer internal-token',
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-encoding')).toBe(null)
    expect(response.headers.get('content-length')).toBe(null)
  })

  it('uses x-api-key for Anthropic', async () => {
    mockVerifyGatewayToken.mockReturnValue({
      userId: 'user-1',
      workspaceSlug: 'ws',
      providerId: 'anthropic',
      version: 1,
      exp: Math.floor(Date.now() / 1000) + 1000,
    })
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-2',
      type: 'api',
      secret: 'encrypted',
      version: 1,
    })
    mockDecryptProviderSecret.mockReturnValue({ apiKey: 'anthropic-key' })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    )

    await callProxy({
      provider: 'anthropic',
      headers: {
        'x-api-key': 'internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: 'hello' }),
    })

    const [, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = options.headers as Headers
    expect(headers.get('x-api-key')).toBe('anthropic-key')
    expect(headers.get('authorization')).toBe(null)
    expect(headers.get('anthropic-version')).toBeTruthy()
  })

  it('proxies to OpenRouter with real api key', async () => {
    mockVerifyGatewayToken.mockReturnValue({
      userId: 'user-1',
      workspaceSlug: 'ws',
      providerId: 'openrouter',
      version: 1,
      exp: Math.floor(Date.now() / 1000) + 1000,
    })
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-or',
      type: 'api',
      secret: 'encrypted',
      version: 1,
    })
    mockDecryptProviderSecret.mockReturnValue({ apiKey: 'or-key' })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    )

    await callProxy({
      provider: 'openrouter',
      path: ['chat', 'completions'],
      headers: {
        Authorization: 'Bearer internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: 'hello' }),
    })

    const [url, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions?foo=bar')
    const headers = options.headers as Headers
    expect(headers.get('authorization')).toBe('Bearer or-key')
    expect(headers.get('x-api-key')).toBe(null)
  })
})

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

const mockGetRuntimeCapabilities = vi.fn()
vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: (...args: unknown[]) => mockGetRuntimeCapabilities(...args),
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
    mockGetRuntimeCapabilities.mockReturnValue({
      multiUser: true,
      auth: true,
      containers: true,
      csrf: true,
      twoFactor: true,
      teamManagement: true,
      connectors: true,
      kickstart: true,
    })

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

  it('normalizes unsupported OpenAI text verbosity for responses API', async () => {
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

    const requestBody = {
      model: 'gpt-5.2-chat-latest',
      input: 'hello',
      text: { verbosity: 'low' },
    }
    const requestBodyJson = JSON.stringify(requestBody)

    await callProxy({
      provider: 'openai',
      path: ['responses'],
      headers: {
        Authorization: 'Bearer internal-token',
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(requestBodyJson)),
      },
      body: requestBodyJson,
      query: '',
    })

    const [, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = options.headers as Headers
    const upstreamBody = JSON.parse(options.body as string) as { text?: { verbosity?: string } }
    expect(upstreamBody.text?.verbosity).toBe('medium')
    expect(headers.get('content-length')).toBe(null)
  })

  it('normalizes unsupported OpenAI reasoning effort for responses API', async () => {
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

    await callProxy({
      provider: 'openai',
      path: ['responses'],
      headers: {
        Authorization: 'Bearer internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.2-chat-latest',
        input: 'hello',
        reasoning: { effort: 'low' },
        reasoning_effort: 'low',
      }),
      query: '',
    })

    const [, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const upstreamBody = JSON.parse(options.body as string) as {
      reasoning?: { effort?: string }
      reasoning_effort?: string
    }
    expect(upstreamBody.reasoning?.effort).toBe('medium')
    expect(upstreamBody.reasoning_effort).toBe('medium')
  })

  it('retries transient OpenAI responses upstream socket errors', async () => {
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-1',
      type: 'api',
      secret: 'encrypted',
      version: 1,
    })
    mockDecryptProviderSecret.mockReturnValue({ apiKey: 'sk-real' })

    const transientError = Object.assign(new Error('socket closed'), {
      cause: { code: 'UND_ERR_SOCKET' },
    })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const response = await callProxy({
      provider: 'openai',
      path: ['responses'],
      headers: {
        Authorization: 'Bearer internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-5.2-chat-latest', input: 'hello' }),
      query: '',
    })

    expect(response.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('returns 502 when OpenAI responses upstream stays unavailable', async () => {
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-1',
      type: 'api',
      secret: 'encrypted',
      version: 1,
    })
    mockDecryptProviderSecret.mockReturnValue({ apiKey: 'sk-real' })

    const transientError = Object.assign(new Error('socket closed'), {
      cause: { code: 'UND_ERR_SOCKET' },
    })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)

    const response = await callProxy({
      provider: 'openai',
      path: ['responses'],
      headers: {
        Authorization: 'Bearer internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-5.2-chat-latest', input: 'hello' }),
      query: '',
    })

    const body = await response.json()
    expect(response.status).toBe(502)
    expect(body.error).toBe('provider_unavailable')
    expect(global.fetch).toHaveBeenCalledTimes(3)
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

  it('proxies to Fireworks with real api key', async () => {
    mockVerifyGatewayToken.mockReturnValue({
      userId: 'user-1',
      workspaceSlug: 'ws',
      providerId: 'fireworks',
      version: 1,
      exp: Math.floor(Date.now() / 1000) + 1000,
    })
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-fw',
      type: 'api',
      secret: 'encrypted',
      version: 1,
    })
    mockDecryptProviderSecret.mockReturnValue({ apiKey: 'fw-key' })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    )

    await callProxy({
      provider: 'fireworks',
      headers: {
        Authorization: 'Bearer internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: 'hello' }),
    })

    const [url, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.fireworks.ai/inference/v1/chat/completions?foo=bar')
    const headers = options.headers as Headers
    expect(headers.get('authorization')).toBe('Bearer fw-key')
    expect(headers.get('x-api-key')).toBe(null)
  })

  it('accepts runtime provider aliases and resolves them to the canonical Fireworks provider', async () => {
    mockVerifyGatewayToken.mockReturnValue({
      userId: 'user-1',
      workspaceSlug: 'ws',
      providerId: 'fireworks',
      version: 1,
      exp: Math.floor(Date.now() / 1000) + 1000,
    })
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-fw',
      type: 'api',
      secret: 'encrypted',
      version: 1,
    })
    mockDecryptProviderSecret.mockReturnValue({ apiKey: 'fw-key' })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    )

    await callProxy({
      provider: 'fireworks-ai',
      headers: {
        Authorization: 'Bearer internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: 'hello' }),
    })

    expect(mockGetActiveCredentialForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      providerId: 'fireworks',
    })

    const [url, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.fireworks.ai/inference/v1/chat/completions?foo=bar')
    const headers = options.headers as Headers
    expect(headers.get('authorization')).toBe('Bearer fw-key')
  })

  it('strips unsupported Fireworks display_name metadata from JSON payloads', async () => {
    mockVerifyGatewayToken.mockReturnValue({
      userId: 'user-1',
      workspaceSlug: 'ws',
      providerId: 'fireworks',
      version: 1,
      exp: Math.floor(Date.now() / 1000) + 1000,
    })
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-fw',
      type: 'api',
      secret: 'encrypted',
      version: 1,
    })
    mockDecryptProviderSecret.mockReturnValue({ apiKey: 'fw-key' })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    )

    await callProxy({
      provider: 'fireworks',
      headers: {
        Authorization: 'Bearer internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'accounts/fireworks/routers/kimi-k2p5-turbo',
        messages: [
          {
            role: 'assistant',
            display_name: 'Assistant',
            content: 'hello',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                display_name: 'Assistant',
                text: 'hi',
              },
            ],
          },
        ],
        metadata: {
          display_name: 'Assistant',
        },
      }),
    })

    const [, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const upstreamBody = JSON.parse(options.body as string) as {
      messages: Array<{
        display_name?: string
        content?: string | Array<{ display_name?: string; text?: string }>
      }>
      metadata?: { display_name?: string }
    }

    expect(upstreamBody.messages[0]?.display_name).toBeUndefined()
    expect(
      Array.isArray(upstreamBody.messages[1]?.content)
        ? upstreamBody.messages[1].content[0]?.display_name
        : undefined
    ).toBeUndefined()
    expect(upstreamBody.metadata?.display_name).toBeUndefined()
  })

  it('proxies to OpenCode Zen with real api key', async () => {
    mockVerifyGatewayToken.mockReturnValue({
      userId: 'user-1',
      workspaceSlug: 'ws',
      providerId: 'opencode',
      version: 1,
      exp: Math.floor(Date.now() / 1000) + 1000,
    })
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-oc',
      type: 'api',
      secret: 'encrypted',
      version: 1,
    })
    mockDecryptProviderSecret.mockReturnValue({ apiKey: 'oc-key' })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    )

    await callProxy({
      provider: 'opencode',
      path: ['models'],
      method: 'GET',
      headers: {
        Authorization: 'Bearer internal-token',
      },
    })

    const [url, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://opencode.ai/zen/v1/models?foo=bar')
    const headers = options.headers as Headers
    expect(headers.get('authorization')).toBe('Bearer oc-key')
    expect(headers.get('x-api-key')).toBe(null)
  })

  it('allows gateway-authenticated OpenCode Zen requests without stored credentials', async () => {
    mockVerifyGatewayToken.mockReturnValue({
      userId: 'user-1',
      workspaceSlug: 'ws',
      providerId: 'opencode',
      version: 0,
      exp: Math.floor(Date.now() / 1000) + 1000,
    })
    mockGetActiveCredentialForUser.mockResolvedValue(null)

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    )

    await callProxy({
      provider: 'opencode',
      path: ['models'],
      method: 'GET',
      headers: {
        Authorization: 'Bearer internal-token',
      },
    })

    const [url, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://opencode.ai/zen/v1/models?foo=bar')
    const headers = options.headers as Headers
    expect(headers.get('authorization')).toBe(null)
  })

  it('accepts OpenCode Zen gateway tokens from x-api-key headers', async () => {
    mockVerifyGatewayToken.mockReturnValue({
      userId: 'user-1',
      workspaceSlug: 'ws',
      providerId: 'opencode',
      version: 0,
      exp: Math.floor(Date.now() / 1000) + 1000,
    })
    mockGetActiveCredentialForUser.mockResolvedValue(null)

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    )

    await callProxy({
      provider: 'opencode',
      path: ['messages'],
      method: 'POST',
      headers: {
        'x-api-key': 'internal-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: 'hello' }),
    })

    const [url, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://opencode.ai/zen/v1/messages?foo=bar')
    const headers = options.headers as Headers
    expect(headers.get('authorization')).toBe(null)
    expect(mockVerifyGatewayToken).toHaveBeenCalledWith('internal-token')
  })

  it('falls back to anonymous OpenCode Zen when a gateway token has expired', async () => {
    mockVerifyGatewayToken.mockImplementation(() => {
      throw new Error('token_expired')
    })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    )

    await callProxy({
      provider: 'opencode',
      path: ['models'],
      method: 'GET',
      headers: {
        Authorization: 'Bearer expired-gateway-token',
      },
    })

    const [url, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://opencode.ai/zen/v1/models?foo=bar')
    const headers = options.headers as Headers
    expect(headers.get('authorization')).toBe(null)
    expect(mockGetActiveCredentialForUser).not.toHaveBeenCalled()
  })

  it('passes through OpenCode Zen workspace tokens when not gateway-managed', async () => {
    mockVerifyGatewayToken.mockImplementation(() => {
      throw new Error('invalid_token')
    })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    )

    await callProxy({
      provider: 'opencode',
      path: ['models'],
      method: 'GET',
      headers: {
        Authorization: 'Bearer zen-user-token',
      },
    })

    const [url, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://opencode.ai/zen/v1/models?foo=bar')
    const headers = options.headers as Headers
    expect(headers.get('authorization')).toBe('Bearer zen-user-token')
    expect(mockGetActiveCredentialForUser).not.toHaveBeenCalled()
  })

  it('allows anonymous OpenCode Zen requests in desktop mode', async () => {
    mockGetRuntimeCapabilities.mockReturnValue({
      multiUser: false,
      auth: false,
      containers: false,
      csrf: false,
      twoFactor: false,
      teamManagement: false,
      connectors: false,
      kickstart: false,
    })

    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 })
    )

    await callProxy({
      provider: 'opencode',
      path: ['messages'],
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: 'hello' }),
    })

    const [url, options] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://opencode.ai/zen/v1/messages?foo=bar')
    const headers = options.headers as Headers
    expect(headers.get('authorization')).toBe(null)
  })
})

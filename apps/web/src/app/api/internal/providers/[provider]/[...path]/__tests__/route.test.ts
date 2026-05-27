import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getE2eFakeProviderUrl: vi.fn(),
  getCanonicalProviderId: vi.fn((id: string) =>
    ['openai', 'anthropic', 'fireworks', 'openrouter', 'opencode', 'ollama'].includes(id) ? id : null,
  ),
  getEffectiveCredentialForUser: vi.fn(),
  verifyGatewayToken: vi.fn(),
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 99, resetAt: Date.now() + 60_000 })),
  decryptProviderSecret: vi.fn(() => ({ apiKey: 'secret-key' })),
  getRuntimeCapabilities: vi.fn(() => ({ auth: true })),
  markCredentialLastUsed: vi.fn(),
  recordProviderGatewayRequest: vi.fn(),
}))

vi.mock('@/lib/providers/crypto', () => ({ decryptProviderSecret: mocks.decryptProviderSecret }))
vi.mock('@/lib/e2e/runtime', () => ({ getE2eFakeProviderUrl: mocks.getE2eFakeProviderUrl }))
vi.mock('@/lib/providers/catalog', () => ({ getCanonicalProviderId: mocks.getCanonicalProviderId }))
vi.mock('@/lib/providers/store', () => ({ getEffectiveCredentialForUser: mocks.getEffectiveCredentialForUser }))
vi.mock('@/lib/providers/tokens', () => ({ verifyGatewayToken: mocks.verifyGatewayToken }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/services', () => ({
  providerService: { markCredentialLastUsed: mocks.markCredentialLastUsed },
  providerUsageService: { recordProviderGatewayRequest: mocks.recordProviderGatewayRequest },
}))

import { DELETE, GET, PATCH, POST, PUT } from '../route'

let fetchMock: ReturnType<typeof vi.fn>

function makeRequest(method: string, url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), { method, ...init })
}

const GATEWAY_PAYLOAD = {
  userId: 'u1',
  workspaceSlug: 'ws1',
  providerId: 'openai',
  version: 1,
  exp: 9_999_999_999,
}

describe('/api/internal/providers/[provider]/[...path]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkRateLimit.mockReturnValue({ allowed: true, remaining: 99, resetAt: Date.now() + 60_000 })
    mocks.getRuntimeCapabilities.mockReturnValue({ auth: true })
    mocks.getCanonicalProviderId.mockImplementation((id: string) =>
      ['openai', 'anthropic', 'fireworks', 'openrouter', 'opencode', 'ollama'].includes(id) ? id : null,
    )
    fetchMock = vi.fn()
    global.fetch = fetchMock
    mocks.verifyGatewayToken.mockReturnValue(GATEWAY_PAYLOAD)
    mocks.getEffectiveCredentialForUser.mockResolvedValue({
      source: 'user',
      credential: {
        id: 'cred-1',
        type: 'api',
        secret: 'enc-secret',
        version: 1,
      },
    })
    mocks.decryptProviderSecret.mockReturnValue({ apiKey: 'openai-key' })
    mocks.markCredentialLastUsed.mockResolvedValue({ count: 1 })
    mocks.recordProviderGatewayRequest.mockResolvedValue(undefined)
  })

  it('returns 400 for invalid provider', async () => {
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/bogus/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'bogus', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_provider')
  })

  it('returns 401 when token is missing and not anonymous opencode', async () => {
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models'),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('unauthorized')
  })

  it('returns 401 for invalid token on non-opencode (openai)', async () => {
    mocks.verifyGatewayToken.mockImplementation(() => {
      throw new Error('invalid_token')
    })
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer bad-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('invalid_token')
  })

  it('returns 429 when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    })
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.error).toBe('rate_limited')
  })

  it('returns 403 when token provider does not match route provider', async () => {
    mocks.verifyGatewayToken.mockReturnValue({ ...GATEWAY_PAYLOAD, providerId: 'fireworks' })
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('provider_mismatch')
  })

  it('returns 401 when no active credential exists for non-opencode', async () => {
    mocks.getEffectiveCredentialForUser.mockResolvedValue(null)
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('unauthorized')
  })

  it('returns 401 when credential version mismatches', async () => {
    mocks.verifyGatewayToken.mockReturnValue({ ...GATEWAY_PAYLOAD, version: 2 })
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('invalid_token')
  })

  it('returns 501 when credential type is not api', async () => {
    mocks.getEffectiveCredentialForUser.mockResolvedValue({
      source: 'user',
      credential: {
        id: 'cred-1',
        type: 'oauth',
        secret: 'enc',
        version: 1,
      },
    })
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(501)
    const json = await res.json()
    expect(json.error).toBe('unsupported_credential')
  })

  it('returns 500 when decrypting provider secret fails', async () => {
    mocks.decryptProviderSecret.mockImplementation(() => {
      throw new Error('bad secret')
    })
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('invalid_credentials')
  })

  it('returns 501 when decrypted secret lacks apiKey', async () => {
    mocks.decryptProviderSecret.mockReturnValue({ apiKey: '' })
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(501)
    const json = await res.json()
    expect(json.error).toBe('unsupported_credential')
  })

  it('returns 502 when upstream fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toBe('provider_unavailable')
  })

  it('returns 502 for retryable fetch error after exhausting retries', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }))
    const res = await POST(
      makeRequest('POST', 'http://localhost/api/internal/providers/openai/v1/responses', {
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'hello' }),
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'responses'] }) },
    )
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toBe('provider_unavailable')
  })

  it('successfully proxies a GET request', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"models":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      }),
    )
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toBe('{"models":[]}')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers),
      }),
    )
    expect(mocks.recordProviderGatewayRequest).toHaveBeenCalledWith({
      credentialSource: 'user',
      isError: false,
      modelId: null,
      providerId: 'openai',
      userId: 'u1',
    })
  })

  it('uses organization credentials when the token source and id match', async () => {
    mocks.verifyGatewayToken.mockReturnValue({
      ...GATEWAY_PAYLOAD,
      credentialId: 'org-cred-1',
      credentialSource: 'organization',
    })
    mocks.getEffectiveCredentialForUser.mockResolvedValue({
      source: 'organization',
      credential: {
        id: 'org-cred-1',
        type: 'api',
        secret: 'enc-secret',
        version: 1,
      },
    })
    mocks.decryptProviderSecret.mockReturnValue({ apiKey: 'org-openai-key' })
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )

    expect(res.status).toBe(200)
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Headers
    expect(sentHeaders.get('authorization')).toBe('Bearer org-openai-key')
    expect(mocks.markCredentialLastUsed).toHaveBeenCalledWith({
      credentialId: 'org-cred-1',
      source: 'organization',
    })
  })

  it('rejects organization credentials when the token credential id is stale', async () => {
    mocks.verifyGatewayToken.mockReturnValue({
      ...GATEWAY_PAYLOAD,
      credentialId: 'old-org-cred',
      credentialSource: 'organization',
    })
    mocks.getEffectiveCredentialForUser.mockResolvedValue({
      source: 'organization',
      credential: {
        id: 'org-cred-1',
        type: 'api',
        secret: 'enc-secret',
        version: 1,
      },
    })

    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('invalid_token')
  })

  it('successfully proxies a POST request to OpenAI responses with normalization', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const res = await POST(
      makeRequest('POST', 'http://localhost/api/internal/providers/openai/responses', {
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'hello', reasoning_effort: 'low' }),
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['responses'] }) },
    )
    expect(res.status).toBe(200)
    const sentBody = JSON.parse(await new Response(fetchMock.mock.calls[0][1].body).text())
    expect(sentBody.reasoning_effort).toBe('medium')
  })

  it('falls back to the raw request body when OpenAI response normalization cannot parse JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/internal/providers/openai/responses', {
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
        },
        body: '{not valid json',
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['responses'] }) },
    )

    expect(res.status).toBe(200)
    await expect(new Response(fetchMock.mock.calls[0][1].body).text()).resolves.toBe('{not valid json')
  })

  it('successfully proxies a request to Fireworks stripping display_name', async () => {
    mocks.verifyGatewayToken.mockReturnValue({ ...GATEWAY_PAYLOAD, providerId: 'fireworks' })
    mocks.getEffectiveCredentialForUser.mockResolvedValue({
      source: 'user',
      credential: {
        id: 'cred-1',
        type: 'api',
        secret: 'enc-secret',
        version: 1,
      },
    })
    mocks.decryptProviderSecret.mockReturnValue({ apiKey: 'fireworks-key' })
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const res = await POST(
      makeRequest('POST', 'http://localhost/api/internal/providers/fireworks/chat/completions', {
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ display_name: 'should-be-removed' }),
      }),
      { params: Promise.resolve({ provider: 'fireworks', path: ['chat', 'completions'] }) },
    )
    expect(res.status).toBe(200)
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sentBody).not.toHaveProperty('display_name')
  })

  it('uses x-api-key for Anthropic', async () => {
    mocks.verifyGatewayToken.mockReturnValue({ ...GATEWAY_PAYLOAD, providerId: 'anthropic' })
    mocks.getEffectiveCredentialForUser.mockResolvedValue({
      source: 'user',
      credential: {
        id: 'cred-1',
        type: 'api',
        secret: 'enc-secret',
        version: 1,
      },
    })
    mocks.decryptProviderSecret.mockReturnValue({ apiKey: 'anthropic-key' })
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/anthropic/v1/messages', {
        headers: { 'x-api-key': 'anthropic-key' },
      }),
      { params: Promise.resolve({ provider: 'anthropic', path: ['v1', 'messages'] }) },
    )
    expect(res.status).toBe(200)
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Headers
    expect(sentHeaders.get('x-api-key')).toBe('anthropic-key')
    expect(sentHeaders.get('anthropic-version')).toBe('2023-06-01')
  })

  it('allows anonymous opencode when auth capability is off', async () => {
    mocks.getRuntimeCapabilities.mockReturnValue({ auth: false })
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/opencode/v1/models'),
      { params: Promise.resolve({ provider: 'opencode', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(200)
  })

  it('records token-authenticated opencode without managed credentials as default usage', async () => {
    mocks.verifyGatewayToken.mockReturnValue({ ...GATEWAY_PAYLOAD, providerId: 'opencode', version: 0 })
    mocks.getEffectiveCredentialForUser.mockResolvedValue(null)
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/internal/providers/opencode/v1/chat/completions', {
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: 'zen-model' }),
      }),
      { params: Promise.resolve({ provider: 'opencode', path: ['v1', 'chat', 'completions'] }) },
    )

    expect(res.status).toBe(200)
    expect(mocks.recordProviderGatewayRequest).toHaveBeenCalledWith({
      credentialSource: 'default',
      isError: false,
      modelId: 'zen-model',
      providerId: 'opencode',
      userId: 'u1',
    })
  })

  it('handles opencode expired token fallback (authorization deleted)', async () => {
    mocks.verifyGatewayToken.mockImplementation(() => {
      throw Object.assign(new Error('token_expired'), { message: 'token_expired' })
    })
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/opencode/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'opencode', path: ['v1', 'models'] }) },
    )
    expect(res.status).toBe(200)
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Headers
    expect(sentHeaders.get('authorization')).toBeNull()
  })

  it.each([
    ['PUT', PUT],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ])('successfully proxies %s requests', async (method, handler) => {
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const res = await handler(
      makeRequest(method, 'http://localhost/api/internal/providers/openai/v1/files/file-1', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'files', 'file-1'] }) },
    )

    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][1].method).toBe(method)
  })

  it('strips hop-by-hop and connection-nominated headers before proxying upstream', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/openai/v1/models', {
        headers: {
          authorization: 'Bearer valid-token',
          connection: 'x-custom, keep-alive',
          'x-custom': 'strip me',
          'keep-alive': 'timeout=5',
        },
      }),
      { params: Promise.resolve({ provider: 'openai', path: ['v1', 'models'] }) },
    )

    expect(res.status).toBe(200)
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Headers
    expect(sentHeaders.get('connection')).toBeNull()
    expect(sentHeaders.get('x-custom')).toBeNull()
    expect(sentHeaders.get('keep-alive')).toBeNull()
    expect(sentHeaders.get('accept-encoding')).toBe('identity')
  })

  it('revalidates remote Ollama credentials and disables redirect following before proxying', async () => {
    mocks.verifyGatewayToken.mockReturnValue({ ...GATEWAY_PAYLOAD, providerId: 'ollama' })
    mocks.decryptProviderSecret.mockReturnValue({
      apiKey: 'ollama-token',
      baseUrl: 'https://203.0.113.10/v1',
      discoveredAt: '2026-05-27T00:00:00.000Z',
      mode: 'remote',
      models: [{ id: 'llama3.2', name: 'llama3.2' }],
    })
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/ollama/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'ollama', path: ['v1', 'models'] }) },
    )

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://203.0.113.10/v1/models',
      expect.objectContaining({ redirect: 'error' }),
    )
    const sentHeaders = fetchMock.mock.calls[0][1].headers as Headers
    expect(sentHeaders.get('authorization')).toBe('Bearer ollama-token')
  })

  it('blocks unsafe Ollama remote credentials before fetching upstream', async () => {
    mocks.verifyGatewayToken.mockReturnValue({ ...GATEWAY_PAYLOAD, providerId: 'ollama' })
    mocks.decryptProviderSecret.mockReturnValue({
      apiKey: 'ollama-token',
      baseUrl: 'https://127.0.0.1/v1',
      discoveredAt: '2026-05-27T00:00:00.000Z',
      mode: 'remote',
      models: [{ id: 'llama3.2', name: 'llama3.2' }],
    })

    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/ollama/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'ollama', path: ['v1', 'models'] }) },
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('blocked_endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks unsafe Ollama local credentials before fetching upstream', async () => {
    mocks.verifyGatewayToken.mockReturnValue({ ...GATEWAY_PAYLOAD, providerId: 'ollama' })
    mocks.decryptProviderSecret.mockReturnValue({
      baseUrl: 'http://169.254.169.254/v1',
      discoveredAt: '2026-05-27T00:00:00.000Z',
      mode: 'local',
      models: [{ id: 'llama3.2', name: 'llama3.2' }],
    })

    const res = await GET(
      makeRequest('GET', 'http://localhost/api/internal/providers/ollama/v1/models', {
        headers: { authorization: 'Bearer valid-token' },
      }),
      { params: Promise.resolve({ provider: 'ollama', path: ['v1', 'models'] }) },
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('blocked_endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

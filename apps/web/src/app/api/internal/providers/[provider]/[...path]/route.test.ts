import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeNextRequest extends Request {
  nextUrl: URL

  constructor(url: string, init?: RequestInit) {
    super(url, init)
    this.nextUrl = new URL(url)
  }
}

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')

  return {
    ...actual,
    NextRequest: FakeNextRequest,
  }
})

const mockCheckRateLimit = vi.fn()
const mockDecryptProviderSecret = vi.fn()
const mockGetActiveCredentialForUser = vi.fn()
const mockGetCanonicalProviderId = vi.fn()
const mockGetRuntimeCapabilities = vi.fn()
const mockVerifyGatewayToken = vi.fn()

vi.mock('@/lib/providers/catalog', () => ({
  getCanonicalProviderId: (...args: unknown[]) => mockGetCanonicalProviderId(...args),
}))

vi.mock('@/lib/providers/crypto', () => ({
  decryptProviderSecret: (...args: unknown[]) => mockDecryptProviderSecret(...args),
}))

vi.mock('@/lib/providers/store', () => ({
  getActiveCredentialForUser: (...args: unknown[]) => mockGetActiveCredentialForUser(...args),
}))

vi.mock('@/lib/providers/tokens', () => ({
  verifyGatewayToken: (...args: unknown[]) => mockVerifyGatewayToken(...args),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => mockGetRuntimeCapabilities(),
}))

function buildRequest(headers?: HeadersInit): Request {
  return new FakeNextRequest('https://arche.example.com/api/internal/providers/openai/responses', {
    body: JSON.stringify({ model: 'gpt-5.4' }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  })
}

describe('POST /api/internal/providers/[provider]/[...path]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCanonicalProviderId.mockReturnValue('openai')
    mockGetRuntimeCapabilities.mockReturnValue({ auth: true })
    mockCheckRateLimit.mockReturnValue({ allowed: true, resetAt: Date.now() + 60_000 })
    mockVerifyGatewayToken.mockReturnValue({
      userId: 'user-1',
      workspaceSlug: 'slack-bot',
      providerId: 'openai',
      version: 1,
    })
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-1',
      secret: 'enc',
      type: 'api',
      version: 2,
    })
    mockDecryptProviderSecret.mockReturnValue({ apiKey: 'sk-test' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })))
  })

  it('rejects gateway tokens whose credential version no longer matches', async () => {
    const { POST } = await import('./route')
    const response = await POST(buildRequest({ authorization: 'Bearer gateway-token' }) as never, {
      params: Promise.resolve({ path: ['responses'], provider: 'openai' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_token' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('forwards the request when the credential version matches the gateway token', async () => {
    mockGetActiveCredentialForUser.mockResolvedValue({
      id: 'cred-1',
      secret: 'enc',
      type: 'api',
      version: 1,
    })

    const { POST } = await import('./route')
    const response = await POST(buildRequest({ authorization: 'Bearer gateway-token' }) as never, {
      params: Promise.resolve({ path: ['responses'], provider: 'openai' }),
    })

    expect(response.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

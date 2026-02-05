import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/opencode/client', () => ({
  getInstanceBasicAuth: vi.fn(),
}))

vi.mock('@/lib/providers/store', () => ({
  getActiveCredentialForUser: vi.fn(),
}))

vi.mock('@/lib/providers/tokens', () => ({
  issueGatewayToken: vi.fn(),
}))

import { getInstanceBasicAuth } from '@/lib/opencode/client'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { getActiveCredentialForUser } from '@/lib/providers/store'
import { issueGatewayToken } from '@/lib/providers/tokens'

const mockGetInstanceBasicAuth = vi.mocked(getInstanceBasicAuth)
const mockGetActiveCredentialForUser = vi.mocked(getActiveCredentialForUser)
const mockIssueGatewayToken = vi.mocked(issueGatewayToken)

describe('syncProviderAccessForInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns instance_unavailable when client is missing', async () => {
    mockGetInstanceBasicAuth.mockResolvedValue(null)

    const result = await syncProviderAccessForInstance({ slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'instance_unavailable' })
  })

  it('sets auth for active credentials and deletes missing providers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('true', { status: 200 })))

    mockGetInstanceBasicAuth.mockResolvedValue({
      baseUrl: 'http://opencode-alice:4096',
      authHeader: 'Basic abc',
    })

    mockGetActiveCredentialForUser.mockImplementation(async ({ providerId }) => {
      if (providerId === 'openai') {
        return { id: 'cred-1', type: 'api', secret: 'secret', version: 2 }
      }
      return null
    })

    mockIssueGatewayToken.mockImplementation(
      ({ providerId }) => `token-${providerId}`
    )

    const result = await syncProviderAccessForInstance({ slug: 'alice', userId: 'user-1' })

    expect(mockIssueGatewayToken).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceSlug: 'alice',
      providerId: 'openai',
      version: 2,
    })

    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    const urls = calls.map((c) => c[0])

    // PUT auth for enabled provider
    expect(urls).toContain('http://opencode-alice:4096/auth/openai')
    // DELETE auth for other providers (best-effort)
    expect(urls).toContain('http://opencode-alice:4096/auth/anthropic')
    expect(urls).toContain('http://opencode-alice:4096/auth/openrouter')
    // Dispose refresh
    expect(urls).toContain('http://opencode-alice:4096/instance/dispose')

    expect(result).toEqual({ ok: true })
  })
})

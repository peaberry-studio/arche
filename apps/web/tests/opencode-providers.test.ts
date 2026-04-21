import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/providers/store', () => ({
  getActiveCredentialForUser: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    setProviderSyncState: vi.fn(),
  },
}))

vi.mock('@/lib/providers/tokens', () => ({
  issueGatewayToken: vi.fn(),
}))

import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { getActiveCredentialForUser } from '@/lib/providers/store'
import { issueGatewayToken } from '@/lib/providers/tokens'

const mockGetActiveCredentialForUser = vi.mocked(getActiveCredentialForUser)
const mockIssueGatewayToken = vi.mocked(issueGatewayToken)

const fakeInstance = {
  baseUrl: 'http://opencode-alice:4096',
  authHeader: 'Basic abc',
}

describe('syncProviderAccessForInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns sync_failed when credential lookup throws', async () => {
    mockGetActiveCredentialForUser.mockRejectedValue(new Error('db error'))

    const result = await syncProviderAccessForInstance({
      instance: fakeInstance,
      slug: 'alice',
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: false, error: 'sync_failed' })
  })

  it('sets auth for active credentials and keeps OpenCode gateway auth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('true', { status: 200 })))

    mockGetActiveCredentialForUser.mockImplementation(async ({ providerId }) => {
      if (providerId === 'openai') {
        return { id: 'cred-1', type: 'api', secret: 'secret', version: 2 }
      }
      return null
    })

    mockIssueGatewayToken.mockImplementation(
      ({ providerId }) => `token-${providerId}`
    )

    const result = await syncProviderAccessForInstance({
      instance: fakeInstance,
      slug: 'alice',
      userId: 'user-1',
    })

    expect(mockIssueGatewayToken).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceSlug: 'alice',
      providerId: 'openai',
      version: 2,
    })
    expect(mockIssueGatewayToken).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceSlug: 'alice',
      providerId: 'opencode',
      version: 0,
    })

    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    const urls = calls.map((c) => c[0])

    // PUT auth for enabled provider
    expect(urls).toContain('http://opencode-alice:4096/auth/openai')
    // DELETE auth for managed providers without credentials (best-effort)
    expect(urls).toContain('http://opencode-alice:4096/auth/anthropic')
    expect(urls).toContain('http://opencode-alice:4096/auth/fireworks-ai')
    expect(urls).toContain('http://opencode-alice:4096/auth/openrouter')
    expect(urls).toContain('http://opencode-alice:4096/auth/opencode')
    // Dispose refresh
    expect(urls).toContain('http://opencode-alice:4096/instance/dispose')

    expect(result).toEqual({ ok: true })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/providers/store', () => ({
  getEnabledProviderCredentialsForUser: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  instanceService: {
    setProviderSyncState: vi.fn(),
  },
  messageRunService: {
    hasActiveRunForSlug: vi.fn(),
  },
}))

vi.mock('@/lib/providers/tokens', () => ({
  issueGatewayToken: vi.fn(),
}))

import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { getEnabledProviderCredentialsForUser, type EnabledProviderCredentials } from '@/lib/providers/store'
import { issueGatewayToken } from '@/lib/providers/tokens'
import type { ProviderId } from '@/lib/providers/types'
import { instanceService, messageRunService } from '@/lib/services'

const mockGetEnabledProviderCredentialsForUser = vi.mocked(getEnabledProviderCredentialsForUser)
const mockIssueGatewayToken = vi.mocked(issueGatewayToken)
const mockHasActiveRunForSlug = vi.mocked(messageRunService.hasActiveRunForSlug)
const mockSetProviderSyncState = vi.mocked(instanceService.setProviderSyncState)

type TestEnabledProviderCredential = {
  credentialId: string
  source: 'user' | 'organization'
  version: number
}

function enabledCredentials(
  entries: Array<[ProviderId, TestEnabledProviderCredential]> = [],
): EnabledProviderCredentials {
  return new Map(entries)
}

const fakeInstance = {
  baseUrl: 'http://opencode-alice:4096',
  authHeader: 'Basic abc',
}

describe('syncProviderAccessForInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasActiveRunForSlug.mockResolvedValue(false)
    mockSetProviderSyncState.mockResolvedValue(undefined)
  })

  it('returns sync_failed when credential lookup throws', async () => {
    mockGetEnabledProviderCredentialsForUser.mockRejectedValue(new Error('db error'))

    const result = await syncProviderAccessForInstance({
      instance: fakeInstance,
      slug: 'alice',
      userId: 'user-1',
    })

    expect(result).toEqual({ ok: false, error: 'sync_failed' })
  })

  it('sets auth for active credentials and keeps OpenCode gateway auth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('true', { status: 200 })))

    mockGetEnabledProviderCredentialsForUser.mockResolvedValue(enabledCredentials([
      ['openai', { credentialId: 'cred-1', source: 'user', version: 2 }],
    ]))

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
      credentialId: 'cred-1',
      credentialSource: 'user',
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
    expect(urls).toContain('http://opencode-alice:4096/auth/huggingface')
    expect(urls).toContain('http://opencode-alice:4096/auth/openrouter')
    expect(urls).toContain('http://opencode-alice:4096/auth/opencode')
    // Dispose refresh
    expect(urls).toContain('http://opencode-alice:4096/instance/dispose')

    expect(result).toEqual({ ok: true })
  })
})

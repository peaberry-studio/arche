import { OpenCode } from '@opencode/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { syncProviderAccess } from '@/lib/harness/adapters/opencode-v2/providers'
import type { HarnessProviderAccessInput } from '@/lib/harness/contract'
import type { HarnessResult } from '@/lib/harness/errors'
import { getEnabledProviderCredentialsForUser } from '@/lib/providers/store'
import { issueGatewayToken } from '@/lib/providers/tokens'
import { instanceService, messageRunService } from '@/lib/services'

vi.mock('@opencode/client', () => ({ OpenCode: { make: vi.fn() } }))
vi.mock('@/lib/providers/store', () => ({ getEnabledProviderCredentialsForUser: vi.fn() }))
vi.mock('@/lib/providers/tokens', () => ({ issueGatewayToken: vi.fn() }))
vi.mock('@/lib/services', () => ({
  instanceService: { findProviderSyncBySlug: vi.fn(), setProviderSyncState: vi.fn() },
  messageRunService: { hasActiveRunForSlug: vi.fn() },
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('syncProviderAccess', () => {
  const sync: (slug: string, input: HarnessProviderAccessInput) => Promise<HarnessResult<void>> = syncProviderAccess

  it.each<HarnessProviderAccessInput>([
    { userId: 'user-1' },
    { userId: 'user-1', force: true },
    { userId: 'user-1', ignoreActiveRunId: 'caller-run' },
    { userId: 'user-1', disposeInstance: false },
    { userId: 'user-1', disposeInstance: true },
    { userId: 'user-1', connection: { baseUrl: 'http://workspace:4096', authHeader: 'Basic synthetic-secret' } },
  ])('refuses unverified sync for %j without any partial mutation or freshness shortcut', async (input) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const result = await sync('alice', input)

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'sync_failed',
        detail: 'OpenCode V2 gateway-only endpoint enforcement, managed credential ownership and complete provider sync orchestration are unverified; no credentials changed, reload performed or freshness recorded',
      },
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(OpenCode.make).not.toHaveBeenCalled()
    expect(getEnabledProviderCredentialsForUser).not.toHaveBeenCalled()
    expect(issueGatewayToken).not.toHaveBeenCalled()
    expect(instanceService.findProviderSyncBySlug).not.toHaveBeenCalled()
    expect(instanceService.setProviderSyncState).not.toHaveBeenCalled()
    expect(messageRunService.hasActiveRunForSlug).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('synthetic-secret')
  })

  it('never reports success for overlapping refresh requests', async () => {
    const results = await Promise.all([
      sync('alice', { userId: 'user-1' }),
      sync('alice', { userId: 'user-1', force: true }),
      sync('bob', { userId: 'user-2' }),
    ])

    expect(results).toHaveLength(3)
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: 'sync_failed' } })
    }
    expect(instanceService.setProviderSyncState).not.toHaveBeenCalled()
  })
})

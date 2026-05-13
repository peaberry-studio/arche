import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireCapabilityMock = vi.fn()

vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}))

import { requireSlackIntegrationAdmin } from '@/lib/slack/route-auth'

describe('slack route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireCapabilityMock.mockReturnValue(null)
  })

  it('allows admins when the Slack integration capability is available', () => {
    expect(requireSlackIntegrationAdmin({ id: 'admin-1', role: 'ADMIN' })).toEqual({ ok: true })
    expect(requireCapabilityMock).toHaveBeenCalledWith('slackIntegration')
  })

  it('rejects non-admin users', async () => {
    const result = requireSlackIntegrationAdmin({ id: 'user-1', role: 'USER' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(403)
      await expect(result.response.json()).resolves.toEqual({ error: 'forbidden' })
    }
  })

  it('returns capability denials before checking admin role', () => {
    const response = Response.json({ error: 'capability_unavailable' }, { status: 503 })
    requireCapabilityMock.mockReturnValue(response)

    expect(requireSlackIntegrationAdmin({ id: 'admin-1', role: 'ADMIN' })).toEqual({
      ok: false,
      response,
    })
  })
})

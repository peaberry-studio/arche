import { describe, expect, it, vi } from 'vitest'

const requireCapabilityMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/runtime/require-capability', () => ({
  requireCapability: requireCapabilityMock,
}))

import { requireKbGithubRemoteAdmin } from '@/lib/kb-github-remote/route-auth'

describe('requireKbGithubRemoteAdmin', () => {
  it('allows admins when the capability is enabled', () => {
    requireCapabilityMock.mockReturnValue(null)

    expect(requireKbGithubRemoteAdmin({ role: 'ADMIN' })).toEqual({ ok: true })
  })

  it('returns capability denials before role checks', () => {
    const denied = new Response(JSON.stringify({ error: 'disabled' }), { status: 404 })
    requireCapabilityMock.mockReturnValue(denied)

    expect(requireKbGithubRemoteAdmin({ role: 'USER' })).toEqual({ ok: false, response: denied })
  })

  it('rejects non-admin users', async () => {
    requireCapabilityMock.mockReturnValue(null)

    const result = requireKbGithubRemoteAdmin({ role: 'USER' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(403)
      await expect(result.response.json()).resolves.toEqual({ error: 'forbidden' })
    }
  })
})

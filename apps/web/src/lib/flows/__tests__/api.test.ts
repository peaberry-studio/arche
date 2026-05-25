import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findIdBySlug: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  userService: {
    findIdBySlug: mocks.findIdBySlug,
  },
}))

import { flowRunActionStatus, resolveFlowRouteContext } from '@/lib/flows/api'

describe('flow API helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the actor as the workspace user when the slug already matches', async () => {
    await expect(resolveFlowRouteContext('alice', { id: 'user-1', role: 'USER', slug: 'alice' })).resolves.toEqual({
      actorSlug: 'alice',
      actorUserId: 'user-1',
      workspaceSlug: 'alice',
      workspaceUserId: 'user-1',
    })
    expect(mocks.findIdBySlug).not.toHaveBeenCalled()
  })

  it('does not resolve another workspace for non-admin actors', async () => {
    await expect(resolveFlowRouteContext('alice', { id: 'user-2', role: 'USER', slug: 'bob' }))
      .resolves.toBeNull()
    expect(mocks.findIdBySlug).not.toHaveBeenCalled()
  })

  it('resolves another workspace slug through userService', async () => {
    mocks.findIdBySlug.mockResolvedValue({ id: 'owner-1' })

    await expect(resolveFlowRouteContext('bob', { id: 'admin-1', role: 'ADMIN', slug: 'admin' })).resolves.toEqual({
      actorSlug: 'admin',
      actorUserId: 'admin-1',
      workspaceSlug: 'bob',
      workspaceUserId: 'owner-1',
    })
  })

  it('maps run action errors to HTTP statuses', () => {
    expect(flowRunActionStatus('not_found')).toBe(404)
    expect(flowRunActionStatus('flow_busy')).toBe(409)
    expect(flowRunActionStatus('invalid_state')).toBe(400)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findIdBySlug: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  userService: {
    findIdBySlug: mocks.findIdBySlug,
  },
}))

import { flowRunActionStatus, resolveFlowOwnerUserId } from '@/lib/flows/api'

describe('flow API helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the context user id when the slug already matches', async () => {
    await expect(resolveFlowOwnerUserId('alice', { id: 'user-1', slug: 'alice' })).resolves.toBe('user-1')
    expect(mocks.findIdBySlug).not.toHaveBeenCalled()
  })

  it('resolves another slug through userService', async () => {
    mocks.findIdBySlug.mockResolvedValue({ id: 'owner-1' })

    await expect(resolveFlowOwnerUserId('bob', { id: 'admin-1', slug: 'admin' })).resolves.toBe('owner-1')
  })

  it('maps run action errors to HTTP statuses', () => {
    expect(flowRunActionStatus('not_found')).toBe(404)
    expect(flowRunActionStatus('flow_busy')).toBe(409)
    expect(flowRunActionStatus('invalid_state')).toBe(400)
  })
})

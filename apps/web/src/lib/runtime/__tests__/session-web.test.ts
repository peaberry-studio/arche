import { describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: () => mockGetAuthenticatedUser(),
}))

import { getWebSession } from '../session-web'

describe('getWebSession', () => {
  it('returns the result from getAuthenticatedUser', async () => {
    const sessionResult = {
      user: {
        id: 'u1',
        email: 'alice@example.com',
        slug: 'alice',
        role: 'ADMIN',
      },
      sessionId: 's1',
    }
    mockGetAuthenticatedUser.mockResolvedValue(sessionResult)
    const result = await getWebSession()
    expect(result).toBe(sessionResult)
  })

  it('returns null when no authenticated user', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null)
    const result = await getWebSession()
    expect(result).toBeNull()
  })
})

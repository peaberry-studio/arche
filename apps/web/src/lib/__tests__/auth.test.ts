import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}))

import { getSessionFromToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)

describe('getSessionFromToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.session.update.mockResolvedValue({} as never)
  })

  it('queries Prisma with explicit select and keeps session contract', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      userId: 'user-1',
      user: {
        id: 'user-1',
        email: 'alice@example.com',
        slug: 'alice',
        role: 'USER'
      }
    } as never)

    const result = await getSessionFromToken('token-1')

    expect(mockPrisma.session.findUnique).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.any(String)
      },
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        userId: true,
        user: {
          select: {
            id: true,
            email: true,
            slug: true,
            role: true
          }
        }
      }
    })

    const query = mockPrisma.session.findUnique.mock.calls[0]?.[0]
    expect(query).not.toHaveProperty('include')

    expect(result).toEqual({
      user: {
        id: 'user-1',
        email: 'alice@example.com',
        slug: 'alice',
        role: 'USER'
      },
      sessionId: 'session-1'
    })
  })
})

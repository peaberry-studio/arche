import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  session: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  findByTokenHash,
  create,
  revokeByTokenHash,
  revokeByUserId,
  revokeByUserIdExceptSession,
  touchLastSeen,
} from '../session'

describe('sessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('findByTokenHash', () => {
    it('queries with user relation', async () => {
      const session = { id: 's1', userId: 'u1', user: { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER' } }
      mockPrisma.session.findUnique.mockResolvedValue(session)
      const result = await findByTokenHash('abc123')
      expect(result).toEqual(session)
      expect(mockPrisma.session.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: 'abc123' },
          select: expect.objectContaining({
            user: expect.objectContaining({
              select: expect.objectContaining({ slug: true }),
            }),
          }),
        }),
      )
    })

    it('returns null when not found', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null)
      expect(await findByTokenHash('nonexistent')).toBeNull()
    })
  })

  describe('create', () => {
    it('creates session with all fields', async () => {
      const data = {
        userId: 'u1',
        tokenHash: 'hash',
        expiresAt: new Date(),
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      }
      mockPrisma.session.create.mockResolvedValue({ id: 's1', ...data })
      await create(data)
      expect(mockPrisma.session.create).toHaveBeenCalledWith({ data })
    })
  })

  describe('revokeByTokenHash', () => {
    it('sets revokedAt for active sessions matching token hash', async () => {
      mockPrisma.session.updateMany.mockResolvedValue({ count: 1 })
      await revokeByTokenHash('hash')
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: 'hash', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      })
    })
  })

  describe('revokeByUserIdExceptSession', () => {
    it('revokes all user sessions except the specified one', async () => {
      mockPrisma.session.updateMany.mockResolvedValue({ count: 3 })
      await revokeByUserIdExceptSession('u1', 's1')
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          revokedAt: null,
          id: { not: 's1' },
        },
        data: { revokedAt: expect.any(Date) },
      })
    })
  })

  describe('revokeByUserId', () => {
    it('revokes all active sessions for a user', async () => {
      mockPrisma.session.updateMany.mockResolvedValue({ count: 2 })
      await revokeByUserId('u1')
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      })
    })
  })

  describe('touchLastSeen', () => {
    it('updates lastSeenAt', async () => {
      mockPrisma.session.update.mockResolvedValue({})
      await touchLastSeen('s1')
      expect(mockPrisma.session.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { lastSeenAt: expect.any(Date) },
      })
    })
  })
})

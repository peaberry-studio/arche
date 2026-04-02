import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    personalAccessToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  create,
  findByLookupHash,
  findManyByUserId,
  revokeByIdAndUserId,
  touchLastUsed,
} from '../personal-access-token'

const mockCreate = vi.mocked(prisma.personalAccessToken.create)
const mockFindUnique = vi.mocked(prisma.personalAccessToken.findUnique)
const mockFindMany = vi.mocked(prisma.personalAccessToken.findMany)
const mockUpdate = vi.mocked(prisma.personalAccessToken.update)
const mockUpdateMany = vi.mocked(prisma.personalAccessToken.updateMany)

describe('personalAccessToken service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('create', () => {
    it('creates a token record with the provided data', async () => {
      const data = {
        userId: 'user-1',
        name: 'My Token',
        lookupHash: 'lookup-123',
        tokenHash: 'token-123',
        salt: 'a'.repeat(32),
        scopes: ['kb:read'],
        expiresAt: new Date('2026-06-01'),
      }
      mockCreate.mockResolvedValue({ id: 'tok-1', ...data } as never)

      const result = await create(data)

      expect(mockCreate).toHaveBeenCalledWith({ data })
      expect(result).toMatchObject({ id: 'tok-1' })
    })
  })

  describe('findByLookupHash', () => {
    it('returns the token with user data when found', async () => {
      const record = {
        id: 'tok-1',
        userId: 'user-1',
        salt: 'a'.repeat(32),
        tokenHash: 'hash-123',
        expiresAt: new Date('2026-06-01'),
        revokedAt: null,
        user: { id: 'user-1', email: 'a@b.com', slug: 'alice', role: 'USER' },
      }
      mockFindUnique.mockResolvedValue(record as never)

      const result = await findByLookupHash('lookup-123')

      expect(mockFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { lookupHash: 'lookup-123' } })
      )
      expect(result).toMatchObject({ id: 'tok-1', user: { slug: 'alice' } })
    })

    it('returns null when not found', async () => {
      mockFindUnique.mockResolvedValue(null as never)
      expect(await findByLookupHash('missing')).toBeNull()
    })
  })

  describe('findManyByUserId', () => {
    it('returns tokens for a user ordered by creation date', async () => {
      mockFindMany.mockResolvedValue([{ id: 'tok-1' }] as never)

      await findManyByUserId('user-1')

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: { createdAt: 'desc' },
        })
      )
    })
  })

  describe('revokeByIdAndUserId', () => {
    it('sets revokedAt only on the scoped token', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 } as never)

      await revokeByIdAndUserId('tok-1', 'user-1')

      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tok-1', userId: 'user-1', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        })
      )
    })
  })

  describe('touchLastUsed', () => {
    it('updates lastUsedAt timestamp', async () => {
      mockUpdate.mockResolvedValue({} as never)

      await touchLastUsed('tok-1')

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tok-1' },
          data: { lastUsedAt: expect.any(Date) },
        })
      )
    })
  })
})

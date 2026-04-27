import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  session: {
    updateMany: vi.fn(),
  },
  twoFactorRecovery: {
    count: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  findIdBySlug,
  findIdentityBySlug,
  findById,
  findByIdSelect,
  findLoginByEmail,
  find2faById,
  findTeamMembers,
  findTeamMemberById,
  findExistingByEmailOrSlug,
  countAdmins,
  create,
  updateRole,
  updatePasswordHash,
  updatePasswordHashAndRevokeSessions,
  updateTotpLastUsedAt,
  updateTotpSecret,
  deleteById,
  enableTwoFactor,
  disableTwoFactor,
  regenerateRecoveryCodes,
  countUnusedRecoveryCodes,
  markRecoveryCodeUsed,
} from '../user'

describe('userService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('findIdBySlug', () => {
    it('returns id-only projection', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' })
      const result = await findIdBySlug('alice')
      expect(result).toEqual({ id: 'u1' })
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        select: { id: true },
      })
    })
  })

  describe('findIdentityBySlug', () => {
    it('returns identity fields', async () => {
      const identity = { id: 'u1', email: 'a@b.com', slug: 'alice' }
      mockPrisma.user.findUnique.mockResolvedValue(identity)
      const result = await findIdentityBySlug('alice')
      expect(result).toEqual(identity)
    })
  })

  describe('findById', () => {
    it('delegates to prisma.user.findUnique', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' })
      await findById('u1')
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } })
    })
  })

  describe('findByIdSelect', () => {
    it('passes custom select', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'a@b.com' })
      await findByIdSelect('u1', { email: true })
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
        select: { email: true },
      })
    })
  })

  describe('findLoginByEmail', () => {
    it('scopes to HUMAN kind', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      await findLoginByEmail('a@b.com')
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'a@b.com', kind: 'HUMAN' },
        select: expect.objectContaining({
          id: true,
          passwordHash: true,
          totpEnabled: true,
        }),
      })
    })
  })

  describe('find2faById', () => {
    it('includes recovery codes where usedAt is null', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      await find2faById('u1')
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'u1', kind: 'HUMAN' },
        select: expect.objectContaining({
          totpSecret: true,
          twoFactorRecovery: expect.objectContaining({
            where: { usedAt: null },
          }),
        }),
      })
    })
  })

  describe('findTeamMembers', () => {
    it('returns all HUMAN users ordered by role then createdAt', async () => {
      mockPrisma.user.findMany.mockResolvedValue([])
      await findTeamMembers()
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { kind: 'HUMAN' },
        select: expect.objectContaining({ id: true, email: true, slug: true, role: true }),
        orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
      })
    })
  })

  describe('findTeamMemberById', () => {
    it('scopes query to HUMAN kind', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      await findTeamMemberById('u1')
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'u1', kind: 'HUMAN' },
        select: expect.objectContaining({ id: true }),
      })
    })
  })

  describe('findExistingByEmailOrSlug', () => {
    it('uses OR query', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      await findExistingByEmailOrSlug('a@b.com', 'alice')
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ email: 'a@b.com' }, { slug: 'alice' }] },
        select: expect.objectContaining({ id: true }),
      })
    })
  })

  describe('countAdmins', () => {
    it('counts HUMAN ADMIN users', async () => {
      mockPrisma.user.count.mockResolvedValue(3)
      const count = await countAdmins()
      expect(count).toBe(3)
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { role: 'ADMIN', kind: 'HUMAN' },
      })
    })
  })

  describe('create', () => {
    it('creates user with HUMAN kind by default', async () => {
      const created = { id: 'u1', email: 'a@b.com', slug: 'alice', role: 'USER', createdAt: new Date() }
      mockPrisma.user.create.mockResolvedValue(created)
      const result = await create({ email: 'a@b.com', slug: 'alice', role: 'USER' as const, passwordHash: 'hash' })
      expect(result).toEqual(created)
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'HUMAN' }),
        }),
      )
    })

    it('respects explicit kind', async () => {
      mockPrisma.user.create.mockResolvedValue({})
      await create({ email: 'svc@b.com', slug: 'svc', role: 'USER' as const, passwordHash: 'h', kind: 'SERVICE' as const })
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'SERVICE' }),
        }),
      )
    })
  })

  describe('updateRole', () => {
    it('updates user role', async () => {
      mockPrisma.user.update.mockResolvedValue({})
      await updateRole('u1', 'ADMIN' as const)
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { role: 'ADMIN' },
        select: expect.objectContaining({ id: true }),
      })
    })
  })

  describe('updatePasswordHash', () => {
    it('sets new password hash', async () => {
      mockPrisma.user.update.mockResolvedValue({})
      await updatePasswordHash('u1', 'new-hash')
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: 'new-hash' },
      })
    })
  })

  describe('updatePasswordHashAndRevokeSessions', () => {
    it('sets the password hash and revokes sessions in one transaction', async () => {
      const txClient = {
        user: { update: vi.fn().mockResolvedValue({}) },
        session: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient))

      await updatePasswordHashAndRevokeSessions('u1', 'new-hash', 's1')

      expect(txClient.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: 'new-hash' },
      })
      expect(txClient.session.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          revokedAt: null,
          id: { not: 's1' },
        },
        data: { revokedAt: expect.any(Date) },
      })
    })
  })

  describe('updateTotpLastUsedAt', () => {
    it('updates timestamp', async () => {
      const date = new Date()
      mockPrisma.user.update.mockResolvedValue({})
      await updateTotpLastUsedAt('u1', date)
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { totpLastUsedAt: date },
      })
    })
  })

  describe('updateTotpSecret', () => {
    it('sets secret and clears verifiedAt', async () => {
      mockPrisma.user.update.mockResolvedValue({})
      await updateTotpSecret('u1', 'JBSWY3DPEHPK3PXP')
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { totpSecret: 'JBSWY3DPEHPK3PXP', totpVerifiedAt: null },
      })
    })
  })

  describe('deleteById', () => {
    it('uses deleteMany for idempotency', async () => {
      mockPrisma.user.deleteMany.mockResolvedValue({ count: 1 })
      await deleteById('u1')
      expect(mockPrisma.user.deleteMany).toHaveBeenCalledWith({ where: { id: 'u1' } })
    })
  })

  describe('enableTwoFactor', () => {
    it('runs in a transaction', async () => {
      const txClient = {
        user: { update: vi.fn().mockResolvedValue({}) },
        twoFactorRecovery: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
      }
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient))

      const codes = [{ userId: 'u1', codeHash: 'hash1' }]
      await enableTwoFactor('u1', codes)

      expect(txClient.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({ totpEnabled: true }),
      })
      expect(txClient.twoFactorRecovery.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
      expect(txClient.twoFactorRecovery.createMany).toHaveBeenCalledWith({ data: codes })
    })
  })

  describe('disableTwoFactor', () => {
    it('clears totp fields and deletes recovery codes in transaction', async () => {
      const txClient = {
        user: { update: vi.fn().mockResolvedValue({}) },
        twoFactorRecovery: { deleteMany: vi.fn().mockResolvedValue({}) },
      }
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient))

      await disableTwoFactor('u1')

      expect(txClient.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({
          totpEnabled: false,
          totpSecret: null,
          totpVerifiedAt: null,
          totpLastUsedAt: null,
        }),
      })
      expect(txClient.twoFactorRecovery.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    })
  })

  describe('regenerateRecoveryCodes', () => {
    it('deletes old codes and creates new ones in transaction', async () => {
      const txClient = {
        twoFactorRecovery: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
      }
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient))

      const codes = [{ userId: 'u1', codeHash: 'h1' }, { userId: 'u1', codeHash: 'h2' }]
      await regenerateRecoveryCodes('u1', codes)

      expect(txClient.twoFactorRecovery.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
      expect(txClient.twoFactorRecovery.createMany).toHaveBeenCalledWith({ data: codes })
    })
  })

  describe('countUnusedRecoveryCodes', () => {
    it('counts codes where usedAt is null', async () => {
      mockPrisma.twoFactorRecovery.count.mockResolvedValue(5)
      const count = await countUnusedRecoveryCodes('u1')
      expect(count).toBe(5)
      expect(mockPrisma.twoFactorRecovery.count).toHaveBeenCalledWith({
        where: { userId: 'u1', usedAt: null },
      })
    })
  })

  describe('markRecoveryCodeUsed', () => {
    it('stamps usedAt', async () => {
      mockPrisma.twoFactorRecovery.update.mockResolvedValue({})
      await markRecoveryCodeUsed('code-1')
      expect(mockPrisma.twoFactorRecovery.update).toHaveBeenCalledWith({
        where: { id: 'code-1' },
        data: { usedAt: expect.any(Date) },
      })
    })
  })
})

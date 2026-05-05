import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  providerCredential: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  clearWorkspaceRestartRequired,
  disableEnabledForProvider,
  findActiveCredential,
  findCredentialsByUserAndProviders,
  hasPendingRestartByUserId,
  markWorkspaceRestartRequired,
  replaceCredential,
} from '../provider'

describe('providerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('findActiveCredential', () => {
    it('returns the latest enabled credential for a user and provider', async () => {
      const cred = { id: 'p1', type: 'api_key', secret: 'enc', version: 3 }
      mockPrisma.providerCredential.findFirst.mockResolvedValue(cred)

      const result = await findActiveCredential('u1', 'openai')

      expect(result).toEqual(cred)
      expect(mockPrisma.providerCredential.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', providerId: 'openai', status: 'enabled' },
          orderBy: { version: 'desc' },
          select: { id: true, type: true, secret: true, version: true },
        }),
      )
    })
  })

  describe('findCredentialsByUserAndProviders', () => {
    it('returns credential summaries for the given providers', async () => {
      const rows = [
        { providerId: 'openai', status: 'enabled', type: 'api_key', version: 1 },
        { providerId: 'anthropic', status: 'disabled', type: 'api_key', version: 2 },
      ]
      mockPrisma.providerCredential.findMany.mockResolvedValue(rows)

      const result = await findCredentialsByUserAndProviders('u1', ['openai', 'anthropic'])

      expect(result).toEqual(rows)
      expect(mockPrisma.providerCredential.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', providerId: { in: ['openai', 'anthropic'] } },
          select: { providerId: true, status: true, type: true, version: true },
          orderBy: { version: 'desc' },
        }),
      )
    })
  })

  describe('hasPendingRestartByUserId', () => {
    it('returns true when a restart-required marker exists', async () => {
      mockPrisma.providerCredential.findFirst.mockResolvedValue({ id: 'p1' })
      const result = await hasPendingRestartByUserId('u1')
      expect(result).toBe(true)
    })

    it('returns false when no restart-required marker exists', async () => {
      mockPrisma.providerCredential.findFirst.mockResolvedValue(null)
      const result = await hasPendingRestartByUserId('u1')
      expect(result).toBe(false)
    })
  })

  describe('replaceCredential', () => {
    it('creates the first version when no previous credential exists', async () => {
      const txClient = {
        providerCredential: {
          findFirst: vi.fn().mockResolvedValue(null),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ id: 'p1', type: 'api', secret: 'enc', version: 1 }),
        },
      }
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof txClient) => unknown) => cb(txClient))

      const result = await replaceCredential({ userId: 'u1', providerId: 'openai', type: 'api', secret: 'enc' })

      expect(result).toEqual({ id: 'p1', type: 'api', secret: 'enc', version: 1 })
      expect(txClient.providerCredential.findFirst).toHaveBeenCalledWith({
        where: { userId: 'u1', providerId: 'openai' },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      expect(txClient.providerCredential.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', providerId: 'openai' },
        data: { status: 'disabled' },
      })
      expect(txClient.providerCredential.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          providerId: 'openai',
          type: 'api',
          status: 'enabled',
          version: 1,
          secret: 'enc',
        },
        select: { id: true, type: true, secret: true, version: true },
      })
    })

    it('retries on serializable transaction conflicts and eventually succeeds', async () => {
      const txClient = {
        providerCredential: {
          findFirst: vi.fn().mockResolvedValue({ version: 2 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({ id: 'p3', type: 'api', secret: 'enc', version: 3 }),
        },
      }
      mockPrisma.$transaction
        .mockRejectedValueOnce({ code: 'P2034' })
        .mockImplementationOnce(async (cb: (tx: typeof txClient) => unknown) => cb(txClient))

      const result = await replaceCredential({ userId: 'u1', providerId: 'openai', type: 'api', secret: 'enc' })

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ id: 'p3', type: 'api', secret: 'enc', version: 3 })
    })

    it('throws after exhausting retries on repeated conflicts', async () => {
      mockPrisma.$transaction.mockRejectedValue({ code: 'P2034' })

      await expect(
        replaceCredential({ userId: 'u1', providerId: 'openai', type: 'api', secret: 'enc' }),
      ).rejects.toEqual({ code: 'P2034' })

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3)
    })

    it('throws non-conflict errors immediately', async () => {
      mockPrisma.$transaction.mockRejectedValue(new Error('db down'))

      await expect(
        replaceCredential({ userId: 'u1', providerId: 'openai', type: 'api', secret: 'enc' }),
      ).rejects.toThrow('db down')

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    })
  })

  describe('disableEnabledForProvider', () => {
    it('disables all enabled credentials for a user and provider', async () => {
      mockPrisma.providerCredential.updateMany.mockResolvedValue({ count: 2 })

      await disableEnabledForProvider('u1', 'openai')

      expect(mockPrisma.providerCredential.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', providerId: 'openai', status: 'enabled' },
        data: { status: 'disabled' },
      })
    })
  })

  describe('markWorkspaceRestartRequired', () => {
    it('sets lastError to restart required for all user credentials', async () => {
      mockPrisma.providerCredential.updateMany.mockResolvedValue({ count: 3 })

      await markWorkspaceRestartRequired('u1')

      expect(mockPrisma.providerCredential.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { lastError: 'workspace_restart_required' },
      })
    })
  })

  describe('clearWorkspaceRestartRequired', () => {
    it('clears the restart required marker for a user', async () => {
      mockPrisma.providerCredential.updateMany.mockResolvedValue({ count: 3 })

      await clearWorkspaceRestartRequired('u1')

      expect(mockPrisma.providerCredential.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', lastError: 'workspace_restart_required' },
        data: { lastError: null },
      })
    })
  })
})

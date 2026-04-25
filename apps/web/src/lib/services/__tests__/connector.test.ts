import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  connector: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  findManyByUserId,
  findEnabledByUserId,
  findEnabledMcpByUserId,
  findHashEntriesByUserId,
  findCapabilityInventoryEntries,
  findByIdAndUserId,
  findByIdAndUserIdSelect,
  findById,
  findFirstByUserIdAndType,
  findEnabledByIdAndUserId,
  create,
  updateByIdUnsafe,
  updateManyByIdAndUserId,
  deleteManyByIdAndUserId,
} from '../connector'

describe('connectorService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('findManyByUserId', () => {
    it('queries by userId ordered by createdAt desc', async () => {
      mockPrisma.connector.findMany.mockResolvedValue([])
      await findManyByUserId('u1')
      expect(mockPrisma.connector.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        select: expect.objectContaining({ id: true, type: true, name: true }),
        orderBy: { createdAt: 'desc' },
      })
    })
  })

  describe('findEnabledByUserId', () => {
    it('filters to enabled connectors', async () => {
      mockPrisma.connector.findMany.mockResolvedValue([])
      await findEnabledByUserId('u1')
      expect(mockPrisma.connector.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', enabled: true },
        select: { id: true, type: true, enabled: true },
      })
    })
  })

  describe('findEnabledMcpByUserId', () => {
    it('includes config and name for MCP', async () => {
      mockPrisma.connector.findMany.mockResolvedValue([])
      await findEnabledMcpByUserId('u1')
      expect(mockPrisma.connector.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', enabled: true },
        select: { id: true, type: true, name: true, config: true, enabled: true },
      })
    })
  })

  describe('findHashEntriesByUserId', () => {
    it('orders by id asc', async () => {
      mockPrisma.connector.findMany.mockResolvedValue([])
      await findHashEntriesByUserId('u1')
      expect(mockPrisma.connector.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        select: { id: true, type: true, enabled: true, updatedAt: true },
        orderBy: { id: 'asc' },
      })
    })
  })

  describe('findCapabilityInventoryEntries', () => {
    it('includes user relation and orders by type, name, id', async () => {
      mockPrisma.connector.findMany.mockResolvedValue([])
      await findCapabilityInventoryEntries()
      expect(mockPrisma.connector.findMany).toHaveBeenCalledWith({
        select: expect.objectContaining({
          user: { select: { kind: true, slug: true } },
        }),
        orderBy: [{ type: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      })
    })
  })

  describe('findByIdAndUserId', () => {
    it('scopes to id and userId', async () => {
      mockPrisma.connector.findFirst.mockResolvedValue(null)
      await findByIdAndUserId('c1', 'u1')
      expect(mockPrisma.connector.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', userId: 'u1' } })
    })
  })

  describe('findByIdAndUserIdSelect', () => {
    it('passes custom select', async () => {
      mockPrisma.connector.findFirst.mockResolvedValue({ config: '{}' })
      await findByIdAndUserIdSelect('c1', 'u1', { config: true })
      expect(mockPrisma.connector.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', userId: 'u1' },
        select: { config: true },
      })
    })
  })

  describe('findById', () => {
    it('queries by id only', async () => {
      mockPrisma.connector.findUnique.mockResolvedValue({ id: 'c1' })
      await findById('c1')
      expect(mockPrisma.connector.findUnique).toHaveBeenCalledWith({ where: { id: 'c1' } })
    })
  })

  describe('findFirstByUserIdAndType', () => {
    it('scopes to userId and type, selects id only', async () => {
      mockPrisma.connector.findFirst.mockResolvedValue({ id: 'c1' })
      await findFirstByUserIdAndType('u1', 'github')
      expect(mockPrisma.connector.findFirst).toHaveBeenCalledWith({
        where: { userId: 'u1', type: 'github' },
        select: { id: true },
      })
    })
  })

  describe('findEnabledByIdAndUserId', () => {
    it('requires enabled=true', async () => {
      mockPrisma.connector.findFirst.mockResolvedValue(null)
      await findEnabledByIdAndUserId('c1', 'u1')
      expect(mockPrisma.connector.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', userId: 'u1', enabled: true },
        select: { id: true, type: true, config: true, userId: true },
      })
    })
  })

  describe('create', () => {
    it('inserts with select', async () => {
      const data = { userId: 'u1', type: 'github', name: 'GH', config: '{}', enabled: true }
      mockPrisma.connector.create.mockResolvedValue({ id: 'c1', ...data })
      await create(data)
      expect(mockPrisma.connector.create).toHaveBeenCalledWith({
        data,
        select: { id: true, type: true, name: true, enabled: true, createdAt: true },
      })
    })
  })

  describe('updateByIdUnsafe', () => {
    it('updates without userId check', async () => {
      mockPrisma.connector.update.mockResolvedValue({})
      await updateByIdUnsafe('c1', { config: '{"new":true}' })
      expect(mockPrisma.connector.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { config: '{"new":true}' },
      })
    })
  })

  describe('updateManyByIdAndUserId', () => {
    it('scopes update to id and userId', async () => {
      mockPrisma.connector.updateMany.mockResolvedValue({ count: 1 })
      await updateManyByIdAndUserId('c1', 'u1', { name: 'Updated' })
      expect(mockPrisma.connector.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', userId: 'u1' },
        data: { name: 'Updated' },
      })
    })
  })

  describe('deleteManyByIdAndUserId', () => {
    it('scopes delete to id and userId', async () => {
      mockPrisma.connector.deleteMany.mockResolvedValue({ count: 1 })
      await deleteManyByIdAndUserId('c1', 'u1')
      expect(mockPrisma.connector.deleteMany).toHaveBeenCalledWith({ where: { id: 'c1', userId: 'u1' } })
    })
  })
})

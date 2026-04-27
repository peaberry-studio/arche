import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetRuntimeCapabilities, mockPrisma } = vi.hoisted(() => ({
  mockGetRuntimeCapabilities: vi.fn(),
  mockPrisma: {
  instance: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
},
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: () => mockGetRuntimeCapabilities(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import {
  findBySlug,
  findCredentialsBySlug,
  findStatusBySlug,
  findProviderSyncBySlug,
  findContainerStatusBySlug,
  findReachableBySlug,
  findAppliedConfigShaBySlug,
  findServerPasswordBySlug,
  findActiveInstances,
  findIdleInstances,
  upsertStarting,
  setContainerId,
  setError,
  setRunning,
  setStopped,
  setStoppedNoContainer,
  setStoppedById,
  setProviderSyncState,
  correctToRunning,
  touchActivity,
  deleteBySlug,
} from '../instance'

describe('instanceService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue({ containers: true })
  })

  describe('findBySlug', () => {
    it('queries by slug', async () => {
      mockPrisma.instance.findUnique.mockResolvedValue({ id: 'i1', slug: 'alice' })
      const result = await findBySlug('alice')
      expect(result).toEqual({ id: 'i1', slug: 'alice' })
      expect(mockPrisma.instance.findUnique).toHaveBeenCalledWith({ where: { slug: 'alice' } })
    })
  })

  describe('findCredentialsBySlug', () => {
    it('selects only serverPassword and status', async () => {
      mockPrisma.instance.findUnique.mockResolvedValue({ serverPassword: 'pwd', status: 'running' })
      await findCredentialsBySlug('alice')
      expect(mockPrisma.instance.findUnique).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        select: { serverPassword: true, status: true },
      })
    })
  })

  describe('findStatusBySlug', () => {
    it('selects status-related fields', async () => {
      mockPrisma.instance.findUnique.mockResolvedValue({ status: 'running' })
      await findStatusBySlug('alice')
      expect(mockPrisma.instance.findUnique).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        select: expect.objectContaining({ status: true, startedAt: true, stoppedAt: true }),
      })
    })
  })

  describe('findProviderSyncBySlug', () => {
    it('selects sync fields', async () => {
      mockPrisma.instance.findUnique.mockResolvedValue({ providerSyncHash: 'h', providerSyncedAt: new Date(), status: 'running' })
      await findProviderSyncBySlug('alice')
      expect(mockPrisma.instance.findUnique).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        select: { providerSyncHash: true, providerSyncedAt: true, status: true },
      })
    })
  })

  describe('findContainerStatusBySlug', () => {
    it('selects containerId and status', async () => {
      mockPrisma.instance.findUnique.mockResolvedValue({ containerId: 'abc', status: 'running' })
      await findContainerStatusBySlug('alice')
      expect(mockPrisma.instance.findUnique).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        select: { containerId: true, status: true },
      })
    })
  })

  describe('findReachableBySlug', () => {
    it('returns reachable=true when running with containerId in container mode', async () => {
      mockGetRuntimeCapabilities.mockReturnValue({ containers: true })
      mockPrisma.instance.findUnique.mockResolvedValue({ containerId: 'abc', status: 'running' })
      const result = await findReachableBySlug('alice')
      expect(result).toEqual({ containerId: 'abc', status: 'running', reachable: true })
    })

    it('returns reachable=false when running without containerId in container mode', async () => {
      mockGetRuntimeCapabilities.mockReturnValue({ containers: true })
      mockPrisma.instance.findUnique.mockResolvedValue({ containerId: null, status: 'running' })
      const result = await findReachableBySlug('alice')
      expect(result!.reachable).toBe(false)
    })

    it('returns reachable=true when running without containerId in non-container mode', async () => {
      mockGetRuntimeCapabilities.mockReturnValue({ containers: false })
      mockPrisma.instance.findUnique.mockResolvedValue({ containerId: null, status: 'running' })
      const result = await findReachableBySlug('alice')
      expect(result!.reachable).toBe(true)
    })

    it('returns reachable=false when not running', async () => {
      mockPrisma.instance.findUnique.mockResolvedValue({ containerId: 'abc', status: 'stopped' })
      const result = await findReachableBySlug('alice')
      expect(result!.reachable).toBe(false)
    })

    it('returns null when instance not found', async () => {
      mockPrisma.instance.findUnique.mockResolvedValue(null)
      expect(await findReachableBySlug('nonexistent')).toBeNull()
    })
  })

  describe('findAppliedConfigShaBySlug', () => {
    it('selects appliedConfigSha', async () => {
      mockPrisma.instance.findUnique.mockResolvedValue({ appliedConfigSha: 'sha1' })
      await findAppliedConfigShaBySlug('alice')
      expect(mockPrisma.instance.findUnique).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        select: { appliedConfigSha: true },
      })
    })
  })

  describe('findServerPasswordBySlug', () => {
    it('selects serverPassword', async () => {
      mockPrisma.instance.findUnique.mockResolvedValue({ serverPassword: 'pwd' })
      await findServerPasswordBySlug('alice')
      expect(mockPrisma.instance.findUnique).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        select: { serverPassword: true },
      })
    })
  })

  describe('findActiveInstances', () => {
    it('queries running and starting instances', async () => {
      mockPrisma.instance.findMany.mockResolvedValue([])
      await findActiveInstances()
      expect(mockPrisma.instance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ['running', 'starting'] } },
          orderBy: { startedAt: 'desc' },
        }),
      )
    })
  })

  describe('findIdleInstances', () => {
    it('queries running instances with old lastActivityAt', async () => {
      const threshold = new Date('2026-04-20T00:00:00Z')
      mockPrisma.instance.findMany.mockResolvedValue([])
      await findIdleInstances(threshold)
      expect(mockPrisma.instance.findMany).toHaveBeenCalledWith({
        where: { status: 'running', lastActivityAt: { lt: threshold } },
      })
    })
  })

  describe('upsertStarting', () => {
    it('creates or updates with starting status', async () => {
      mockPrisma.instance.upsert.mockResolvedValue({})
      await upsertStarting('alice', 'pwd')
      expect(mockPrisma.instance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: 'alice' },
          create: expect.objectContaining({ slug: 'alice', status: 'starting', serverPassword: 'pwd' }),
          update: expect.objectContaining({ status: 'starting', serverPassword: 'pwd', containerId: null }),
        }),
      )
    })
  })

  describe('setContainerId', () => {
    it('sets containerId', async () => {
      mockPrisma.instance.update.mockResolvedValue({})
      await setContainerId('alice', 'container-123')
      expect(mockPrisma.instance.update).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        data: { containerId: 'container-123' },
      })
    })
  })

  describe('setError', () => {
    it('sets error status and clears containerId', async () => {
      mockPrisma.instance.update.mockResolvedValue({})
      await setError('alice')
      expect(mockPrisma.instance.update).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        data: { status: 'error', containerId: null, providerSyncHash: null, providerSyncedAt: null },
      })
    })
  })

  describe('setRunning', () => {
    it('sets running with config sha', async () => {
      mockPrisma.instance.update.mockResolvedValue({})
      await setRunning('alice', 'sha-abc')
      expect(mockPrisma.instance.update).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        data: expect.objectContaining({ status: 'running', appliedConfigSha: 'sha-abc' }),
      })
    })
  })

  describe('setStopped', () => {
    it('clears containerId and sync state', async () => {
      mockPrisma.instance.update.mockResolvedValue({})
      await setStopped('alice')
      const call = mockPrisma.instance.update.mock.calls[0][0]
      expect(call.data.status).toBe('stopped')
      expect(call.data.containerId).toBeNull()
      expect(call.data.providerSyncHash).toBeNull()
    })
  })

  describe('setStoppedNoContainer', () => {
    it('preserves containerId', async () => {
      mockPrisma.instance.update.mockResolvedValue({})
      await setStoppedNoContainer('alice')
      const call = mockPrisma.instance.update.mock.calls[0][0]
      expect(call.data.status).toBe('stopped')
      expect(call.data).not.toHaveProperty('containerId')
    })
  })

  describe('setStoppedById', () => {
    it('uses id instead of slug', async () => {
      mockPrisma.instance.update.mockResolvedValue({})
      await setStoppedById('instance-id-1')
      expect(mockPrisma.instance.update).toHaveBeenCalledWith({
        where: { id: 'instance-id-1' },
        data: expect.objectContaining({ status: 'stopped', containerId: null }),
      })
    })
  })

  describe('setProviderSyncState', () => {
    it('persists hash and timestamp', async () => {
      const syncedAt = new Date()
      mockPrisma.instance.update.mockResolvedValue({})
      await setProviderSyncState('alice', 'hash-123', syncedAt)
      expect(mockPrisma.instance.update).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        data: { providerSyncHash: 'hash-123', providerSyncedAt: syncedAt },
      })
    })
  })

  describe('correctToRunning', () => {
    it('sets running and touches lastActivityAt', async () => {
      mockPrisma.instance.update.mockResolvedValue({})
      await correctToRunning('alice')
      expect(mockPrisma.instance.update).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        data: { status: 'running', lastActivityAt: expect.any(Date) },
      })
    })
  })

  describe('touchActivity', () => {
    it('updates lastActivityAt', async () => {
      mockPrisma.instance.update.mockResolvedValue({})
      await touchActivity('alice')
      expect(mockPrisma.instance.update).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        data: { lastActivityAt: expect.any(Date) },
      })
    })
  })

  describe('deleteBySlug', () => {
    it('deletes by slug', async () => {
      mockPrisma.instance.deleteMany.mockResolvedValue({ count: 1 })
      await deleteBySlug('alice')
      expect(mockPrisma.instance.deleteMany).toHaveBeenCalledWith({ where: { slug: 'alice' } })
    })
  })
})

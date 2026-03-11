import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = {
  instance: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
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
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  connector: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  providerCredential: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditEvent: {
    create: vi.fn(),
  },
  twoFactorRecovery: {
    count: vi.fn(),
    update: vi.fn(),
  },
  $queryRaw: vi.fn(),
}

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

describe('service layer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('barrel exports', () => {
    it('exports all service modules', async () => {
      const services = await import('../index')
      expect(services.instanceService).toBeDefined()
      expect(services.userService).toBeDefined()
      expect(services.connectorService).toBeDefined()
      expect(services.providerService).toBeDefined()
      expect(services.sessionService).toBeDefined()
      expect(services.auditService).toBeDefined()
      expect(services.healthService).toBeDefined()
    })
  })

  describe('instanceService', () => {
    it('findBySlug calls prisma.instance.findUnique', async () => {
      const mockInstance = { id: 'i1', slug: 'alice', status: 'running' }
      mockPrisma.instance.findUnique.mockResolvedValue(mockInstance)

      const { instanceService } = await import('../index')
      const result = await instanceService.findBySlug('alice')

      expect(result).toEqual(mockInstance)
      expect(mockPrisma.instance.findUnique).toHaveBeenCalledWith({ where: { slug: 'alice' } })
    })

    it('findActiveInstances queries running and starting instances', async () => {
      mockPrisma.instance.findMany.mockResolvedValue([])

      const { instanceService } = await import('../index')
      await instanceService.findActiveInstances()

      expect(mockPrisma.instance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ['running', 'starting'] } },
        })
      )
    })

    it('upsertStarting creates or updates instance with starting status', async () => {
      mockPrisma.instance.upsert.mockResolvedValue({ slug: 'alice', status: 'starting' })

      const { instanceService } = await import('../index')
      await instanceService.upsertStarting('alice', 'password123')

      expect(mockPrisma.instance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: 'alice' },
          create: expect.objectContaining({ slug: 'alice', status: 'starting', serverPassword: 'password123' }),
          update: expect.objectContaining({ status: 'starting', serverPassword: 'password123' }),
        })
      )
    })

    it('deleteBySlug calls prisma.instance.deleteMany', async () => {
      mockPrisma.instance.deleteMany.mockResolvedValue({ count: 1 })

      const { instanceService } = await import('../index')
      await instanceService.deleteBySlug('alice')

      expect(mockPrisma.instance.deleteMany).toHaveBeenCalledWith({ where: { slug: 'alice' } })
    })
  })

  describe('userService', () => {
    it('findIdBySlug returns id-only projection', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' })

      const { userService } = await import('../index')
      const result = await userService.findIdBySlug('alice')

      expect(result).toEqual({ id: 'u1' })
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: 'alice' },
          select: { id: true },
        })
      )
    })

    it('countAdmins queries users with ADMIN role', async () => {
      mockPrisma.user.count.mockResolvedValue(2)

      const { userService } = await import('../index')
      const count = await userService.countAdmins()

      expect(count).toBe(2)
      expect(mockPrisma.user.count).toHaveBeenCalledWith({ where: { role: 'ADMIN' } })
    })
  })

  describe('sessionService', () => {
    it('findByTokenHash queries session with user relation', async () => {
      const mockSession = { id: 's1', tokenHash: 'abc' }
      mockPrisma.session.findUnique.mockResolvedValue(mockSession)

      const { sessionService } = await import('../index')
      const result = await sessionService.findByTokenHash('abc')

      expect(result).toEqual(mockSession)
    })
  })

  describe('auditService', () => {
    it('createEvent calls prisma.auditEvent.create', async () => {
      mockPrisma.auditEvent.create.mockResolvedValue({ id: 'a1' })

      const { auditService } = await import('../index')
      await auditService.createEvent({
        actorUserId: 'u1',
        action: 'user.login',
      })

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorUserId: 'u1', action: 'user.login' }),
      })
    })
  })
})

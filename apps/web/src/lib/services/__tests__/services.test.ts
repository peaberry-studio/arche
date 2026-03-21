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
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  providerCredential: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
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

    it('createEvent logs a warning when prisma call fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockPrisma.auditEvent.create.mockRejectedValue(new Error('db down'))

      const { auditService } = await import('../index')
      await auditService.createEvent({ action: 'user.login' })

      expect(warnSpy).toHaveBeenCalledWith('audit event failed:', 'user.login', expect.any(Error))
      warnSpy.mockRestore()
    })
  })

  describe('connectorService', () => {
    it('create inserts a connector and returns selected fields', async () => {
      const created = { id: 'c1', type: 'github', name: 'GH', enabled: true, createdAt: new Date() }
      mockPrisma.connector.create.mockResolvedValue(created)

      const { connectorService } = await import('../index')
      const result = await connectorService.create({
        userId: 'u1', type: 'github', name: 'GH', config: '{}', enabled: true,
      })

      expect(result).toEqual(created)
      expect(mockPrisma.connector.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', type: 'github' }) })
      )
    })

    it('findByIdAndUserId scopes query to both id and userId', async () => {
      mockPrisma.connector.findFirst.mockResolvedValue({ id: 'c1' })

      const { connectorService } = await import('../index')
      await connectorService.findByIdAndUserId('c1', 'u1')

      expect(mockPrisma.connector.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', userId: 'u1' } })
    })

    it('updateManyByIdAndUserId scopes update to both id and userId', async () => {
      mockPrisma.connector.updateMany.mockResolvedValue({ count: 1 })

      const { connectorService } = await import('../index')
      await connectorService.updateManyByIdAndUserId('c1', 'u1', { name: 'Updated' })

      expect(mockPrisma.connector.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', userId: 'u1' },
        data: { name: 'Updated' },
      })
    })

    it('deleteManyByIdAndUserId scopes delete to both id and userId', async () => {
      mockPrisma.connector.deleteMany.mockResolvedValue({ count: 1 })

      const { connectorService } = await import('../index')
      await connectorService.deleteManyByIdAndUserId('c1', 'u1')

      expect(mockPrisma.connector.deleteMany).toHaveBeenCalledWith({ where: { id: 'c1', userId: 'u1' } })
    })
  })

  describe('providerService', () => {
    it('findActiveCredential returns enabled credential with highest version', async () => {
      const cred = { id: 'p1', type: 'api_key', secret: 'enc', version: 2 }
      mockPrisma.providerCredential.findFirst.mockResolvedValue(cred)

      const { providerService } = await import('../index')
      const result = await providerService.findActiveCredential('u1', 'openai')

      expect(result).toEqual(cred)
      expect(mockPrisma.providerCredential.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', providerId: 'openai', status: 'enabled' },
          orderBy: { version: 'desc' },
        })
      )
    })

    it('createCredential inserts a new credential record', async () => {
      const cred = { id: 'p1', type: 'api_key', secret: 'enc', version: 1 }
      mockPrisma.providerCredential.create.mockResolvedValue(cred)

      const { providerService } = await import('../index')
      const result = await providerService.createCredential({
        userId: 'u1', providerId: 'openai', type: 'api_key', status: 'enabled', version: 1, secret: 'enc',
      })

      expect(result).toEqual(cred)
    })

    it('disableAllForProvider updates all credentials for a provider to disabled', async () => {
      mockPrisma.providerCredential.updateMany.mockResolvedValue({ count: 2 })

      const { providerService } = await import('../index')
      await providerService.disableAllForProvider('u1', 'openai')

      expect(mockPrisma.providerCredential.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', providerId: 'openai' },
        data: { status: 'disabled' },
      })
    })
  })

  describe('instanceService — status setters', () => {
    it('setRunning updates status to running with config sha', async () => {
      mockPrisma.instance.update.mockResolvedValue({ slug: 'alice', status: 'running' })

      const { instanceService } = await import('../index')
      await instanceService.setRunning('alice', 'sha256abc')

      expect(mockPrisma.instance.update).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        data: expect.objectContaining({ status: 'running', appliedConfigSha: 'sha256abc' }),
      })
    })

    it('setStopped updates status to stopped and clears containerId', async () => {
      mockPrisma.instance.update.mockResolvedValue({ slug: 'alice', status: 'stopped' })

      const { instanceService } = await import('../index')
      await instanceService.setStopped('alice')

      expect(mockPrisma.instance.update).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        data: expect.objectContaining({ status: 'stopped', containerId: null }),
      })
    })

    it('setError updates status to error and clears containerId', async () => {
      mockPrisma.instance.update.mockResolvedValue({ slug: 'alice', status: 'error' })

      const { instanceService } = await import('../index')
      await instanceService.setError('alice')

      expect(mockPrisma.instance.update).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        data: { status: 'error', containerId: null },
      })
    })

    it('setStoppedNoContainer updates status without clearing containerId', async () => {
      mockPrisma.instance.update.mockResolvedValue({ slug: 'alice', status: 'stopped' })

      const { instanceService } = await import('../index')
      await instanceService.setStoppedNoContainer('alice')

      const call = mockPrisma.instance.update.mock.calls[0][0]
      expect(call.data.status).toBe('stopped')
      expect(call.data).not.toHaveProperty('containerId')
    })
  })

  describe('healthService', () => {
    it('pingDatabase returns true when query succeeds', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ 1: 1 }])

      const { healthService } = await import('../index')
      const result = await healthService.pingDatabase()

      expect(result).toBe(true)
    })

    it('pingDatabase returns false when query fails', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('connection refused'))

      const { healthService } = await import('../index')
      const result = await healthService.pingDatabase()

      expect(result).toBe(false)
    })
  })
})

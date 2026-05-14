import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetContainerProxyUrl = vi.fn(() => 'http://docker-socket-proxy:2375')
vi.mock('@/lib/spawner/config', () => ({
  getContainerProxyUrl: (...args: unknown[]) => mockGetContainerProxyUrl(...args),
}))

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
  slackEventReceipt: {
    create: vi.fn(),
  },
  externalIntegration: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
  slackThreadBinding: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  autopilotTask: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  autopilotRun: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  twoFactorRecovery: {
    count: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
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
      expect(services.autopilotService).toBeDefined()
      expect(services.slackService).toBeDefined()
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
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { kind: 'HUMAN', role: 'ADMIN' },
      })
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

    it('findCapabilityInventoryEntries returns connector owners', async () => {
      mockPrisma.connector.findMany.mockResolvedValue([])

      const { connectorService } = await import('../index')
      await connectorService.findCapabilityInventoryEntries()

      expect(mockPrisma.connector.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          type: true,
          name: true,
          enabled: true,
          user: {
            select: {
              kind: true,
              slug: true,
            },
          },
        },
        orderBy: [
          { type: 'asc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
      })
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

  describe('autopilotService', () => {
    it('listTasksByUserId scopes active tasks to the user and includes latest runs', async () => {
      mockPrisma.autopilotTask.findMany.mockResolvedValue([])

      const { autopilotService } = await import('../index')
      await autopilotService.listTasksByUserId('user-1')

      expect(mockPrisma.autopilotTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, userId: 'user-1' },
          include: expect.objectContaining({
            runs: expect.objectContaining({ take: 1 }),
          }),
        })
      )
    })

    it('releaseTaskLease clears the lease and updates lastRunAt', async () => {
      mockPrisma.autopilotTask.updateMany.mockResolvedValue({ count: 1 })
      const lastRunAt = new Date('2026-04-12T10:00:00.000Z')

      const { autopilotService } = await import('../index')
      await autopilotService.releaseTaskLease('task-1', 'lease-1', lastRunAt)

      expect(mockPrisma.autopilotTask.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'task-1',
          leaseOwner: 'lease-1',
        },
        data: {
          lastRunAt,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      })
    })

    it('markRunResultSeenByIdAndUserId only marks completed unseen runs', async () => {
      const seenAt = new Date('2026-04-12T11:00:00.000Z')
      mockPrisma.autopilotRun.findFirst.mockResolvedValue({
        id: 'run-1',
        status: 'succeeded',
        resultSeenAt: null,
      })
      mockPrisma.autopilotRun.updateMany.mockResolvedValue({ count: 1 })

      const { autopilotService } = await import('../index')
      const result = await autopilotService.markRunResultSeenByIdAndUserId('run-1', 'user-1', seenAt)

      expect(result).toBe(true)
      expect(mockPrisma.autopilotRun.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'run-1',
          task: {
            userId: 'user-1',
          },
        },
        select: {
          id: true,
          resultSeenAt: true,
          status: true,
        },
      })
      expect(mockPrisma.autopilotRun.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'run-1',
          resultSeenAt: null,
        },
        data: {
          resultSeenAt: seenAt,
        },
      })
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

    it('replaceCredential disables previous versions and creates the next version in one transaction', async () => {
      const transactionClient = {
        providerCredential: {
          findFirst: vi.fn().mockResolvedValue({ version: 2 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({ id: 'p2', type: 'api', secret: 'enc', version: 3 }),
        },
      }
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) =>
        callback(transactionClient),
      )

      const { providerService } = await import('../index')
      const result = await providerService.replaceCredential({
        userId: 'u1',
        providerId: 'openai',
        type: 'api',
        secret: 'enc',
      })

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
      expect(mockPrisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          isolationLevel: 'Serializable',
        }),
      )
      expect(transactionClient.providerCredential.findFirst).toHaveBeenCalledWith({
        where: { userId: 'u1', providerId: 'openai' },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      expect(transactionClient.providerCredential.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', providerId: 'openai' },
        data: { status: 'disabled' },
      })
      expect(transactionClient.providerCredential.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          providerId: 'openai',
          type: 'api',
          status: 'enabled',
          version: 3,
          secret: 'enc',
        },
        select: { id: true, type: true, secret: true, version: true },
      })
      expect(result).toEqual({ id: 'p2', type: 'api', secret: 'enc', version: 3 })
    })

    it('replaceCredential retries on Prisma write conflicts', async () => {
      const transactionClient = {
        providerCredential: {
          findFirst: vi.fn().mockResolvedValue({ version: 4 }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({ id: 'p5', type: 'api', secret: 'enc', version: 5 }),
        },
      }

      mockPrisma.$transaction
        .mockRejectedValueOnce({ code: 'P2034' })
        .mockImplementationOnce(async (callback: (tx: typeof transactionClient) => unknown) =>
          callback(transactionClient),
        )

      const { providerService } = await import('../index')
      const result = await providerService.replaceCredential({
        userId: 'u1',
        providerId: 'openai',
        type: 'api',
        secret: 'enc',
      })

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ id: 'p5', type: 'api', secret: 'enc', version: 5 })
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
        data: {
          status: 'error',
          containerId: null,
          providerSyncHash: null,
          providerSyncedAt: null,
        },
      })
    })

    it('setProviderSyncState persists the latest provider sync hash and timestamp', async () => {
      const syncedAt = new Date('2026-04-21T10:00:00.000Z')
      mockPrisma.instance.update.mockResolvedValue({ slug: 'alice', providerSyncHash: 'hash-123' })

      const { instanceService } = await import('../index')
      await instanceService.setProviderSyncState('alice', 'hash-123', syncedAt)

      expect(mockPrisma.instance.update).toHaveBeenCalledWith({
        where: { slug: 'alice' },
        data: {
          providerSyncHash: 'hash-123',
          providerSyncedAt: syncedAt,
        },
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

    it('checkContainerProxy returns true when proxy responds ok', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('OK', { status: 200 }),
      )

      const { healthService } = await import('../index')
      const result = await healthService.checkContainerProxy()

      expect(result).toBe(true)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://docker-socket-proxy:2375/_ping',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
      fetchSpy.mockRestore()
    })

    it('checkContainerProxy returns false when proxy returns non-ok status', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Service Unavailable', { status: 503 }),
      )

      const { healthService } = await import('../index')
      const result = await healthService.checkContainerProxy()

      expect(result).toBe(false)
      fetchSpy.mockRestore()
    })

    it('checkContainerProxy returns false when fetch throws', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('network error'),
      )

      const { healthService } = await import('../index')
      const result = await healthService.checkContainerProxy()

      expect(result).toBe(false)
      fetchSpy.mockRestore()
    })

    it('checkContainerProxy uses getContainerProxyUrl', async () => {
      mockGetContainerProxyUrl.mockReturnValue('http://custom-host:1234')
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('OK', { status: 200 }),
      )

      const { healthService } = await import('../index')
      await healthService.checkContainerProxy()

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://custom-host:1234/_ping',
        expect.anything(),
      )
      fetchSpy.mockRestore()
    })
  })
})

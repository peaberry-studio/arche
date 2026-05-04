import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockProviderUpdateMany = vi.fn()

// Mock runtime session
vi.mock('@/lib/runtime/session', () => ({
  getSession: vi.fn(),
}))

// Mock workspace host (start, stop, status, connection)
vi.mock('@/lib/runtime/workspace-host', () => ({
  startWorkspace: vi.fn(),
  stopWorkspace: vi.fn(),
  getWorkspaceStatus: vi.fn(),
  getWorkspaceConnection: vi.fn().mockResolvedValue({
    baseUrl: 'http://opencode-alice:4096',
    authHeader: 'Basic dGVzdA==',
  }),
}))

// Mock prisma (imported by actions for provider sync)
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    providerCredential: {
      updateMany: (...args: unknown[]) => mockProviderUpdateMany(...args),
    },
  },
}))

// Mock provider sync (imported by ensureInstanceRunningAction)
vi.mock('@/lib/opencode/providers', () => ({
  syncProviderAccessForInstance: vi.fn().mockResolvedValue({ ok: true }),
}))

// Mock spawner core (only isSlowStart is still imported from here)
vi.mock('@/lib/spawner/core', () => ({
  isSlowStart: vi.fn(() => false),
  listActiveInstances: vi.fn(),
}))

const mockGetKickstartStatus = vi.fn()
vi.mock('@/kickstart/status', () => ({
  getKickstartStatus: (...args: unknown[]) => mockGetKickstartStatus(...args),
}))

import { getSession } from '@/lib/runtime/session'
import { startWorkspace, stopWorkspace, getWorkspaceStatus, getWorkspaceConnection } from '@/lib/runtime/workspace-host'
import { prisma } from '@/lib/prisma'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { listActiveInstances, isSlowStart } from '@/lib/spawner/core'
import { startInstanceAction, stopInstanceAction, getInstanceStatusAction, ensureInstanceRunningAction, listActiveInstancesAction } from '../spawner'

const mockGetSession = vi.mocked(getSession)
const mockStart = vi.mocked(startWorkspace)
const mockStop = vi.mocked(stopWorkspace)
const mockStatus = vi.mocked(getWorkspaceStatus)
const mockPrisma = vi.mocked(prisma)
const mockGetWorkspaceConnection = vi.mocked(getWorkspaceConnection)
const mockSync = vi.mocked(syncProviderAccessForInstance)
const mockIsSlowStart = vi.mocked(isSlowStart)
const mockListActiveInstances = vi.mocked(listActiveInstances)

const fakeSession = {
  user: { id: 'user-1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
  sessionId: 'sess-1',
}

const adminSession = {
  user: { id: 'admin-1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 'sess-2',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetKickstartStatus.mockResolvedValue('ready')
  mockIsSlowStart.mockReturnValue(false)
  mockProviderUpdateMany.mockResolvedValue({ count: 0 })
})

describe('startInstanceAction', () => {
  it('returns unauthorized without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await startInstanceAction('alice')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns forbidden if slug does not match and not admin', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    const result = await startInstanceAction('bob')
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('allows admin to start any instance', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    mockStart.mockResolvedValue({ ok: true, status: 'running' })
    const result = await startInstanceAction('alice')
    expect(result).toEqual({ ok: true, status: 'running' })
  })

  it('allows user to start own instance', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStart.mockResolvedValue({ ok: true, status: 'running' })
    const result = await startInstanceAction('alice')
    expect(result).toEqual({ ok: true, status: 'running' })
    expect(mockStart).toHaveBeenCalledWith('alice', 'user-1')
  })

  it('returns setup_required when kickstart is incomplete', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockGetKickstartStatus.mockResolvedValue('needs_setup')

    const result = await startInstanceAction('alice')
    expect(result).toEqual({ ok: false, error: 'setup_required' })
    expect(mockStart).not.toHaveBeenCalled()
  })
})

describe('stopInstanceAction', () => {
  it('returns unauthorized without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await stopInstanceAction('alice')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns forbidden if slug does not match and not admin', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    const result = await stopInstanceAction('bob')
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('allows user to stop own instance', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStop.mockResolvedValue({ ok: true, status: 'stopped' })
    const result = await stopInstanceAction('alice')
    expect(result).toEqual({ ok: true, status: 'stopped' })
  })
})

describe('getInstanceStatusAction', () => {
  it('returns null without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await getInstanceStatusAction('alice')
    expect(result).toBeNull()
  })

  it('returns null when a regular user requests another slug', async () => {
    mockGetSession.mockResolvedValue(fakeSession)

    const result = await getInstanceStatusAction('bob')

    expect(result).toBeNull()
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it('returns default stopped when no instance exists', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue(null)
    const result = await getInstanceStatusAction('alice')
    expect(result).toEqual({ status: 'stopped', slowStart: false })
  })

  it('returns instance status with slowStart flag', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockIsSlowStart.mockReturnValue(true)
    mockStatus.mockResolvedValue({
      status: 'running',
      startedAt: new Date(),
      stoppedAt: null,
      lastActivityAt: new Date(),
    })
    const result = await getInstanceStatusAction('alice')
    expect(result).toMatchObject({ status: 'running', slowStart: true })
  })
})

describe('listActiveInstancesAction', () => {
  it('returns an empty list without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    const result = await listActiveInstancesAction()

    expect(result).toEqual([])
  })

  it('returns only the regular user running workspace', async () => {
    const startedAt = new Date('2026-05-01T10:00:00.000Z')
    const lastActivityAt = new Date('2026-05-01T10:30:00.000Z')
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({
      status: 'running',
      startedAt,
      lastActivityAt,
    } as never)

    const result = await listActiveInstancesAction()

    expect(result).toEqual([
      {
        slug: 'alice',
        status: 'running',
        startedAt,
        lastActivityAt,
      },
    ])
    expect(mockListActiveInstances).not.toHaveBeenCalled()
  })

  it('returns an empty list for regular users without an active workspace', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'stopped' } as never)

    const result = await listActiveInstancesAction()

    expect(result).toEqual([])
  })

  it('delegates to the active instance list for admins', async () => {
    const instances = [{ slug: 'alice', status: 'running' }]
    mockGetSession.mockResolvedValue(adminSession)
    mockListActiveInstances.mockResolvedValue(instances as never)

    const result = await listActiveInstancesAction()

    expect(result).toBe(instances)
  })
})

describe('ensureInstanceRunningAction', () => {
  it('returns unauthorized without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await ensureInstanceRunningAction('alice')
    expect(result).toEqual({ status: 'error', error: 'unauthorized' })
  })

  it('returns forbidden for another user slug', async () => {
    mockGetSession.mockResolvedValue(fakeSession)

    const result = await ensureInstanceRunningAction('bob')

    expect(result).toEqual({ status: 'error', error: 'forbidden' })
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it('returns running and syncs providers when instance is already running (own slug)', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockGetWorkspaceConnection).toHaveBeenCalledWith('alice')
    expect(mockSync).toHaveBeenCalledWith({
      instance: expect.objectContaining({ baseUrl: expect.any(String), authHeader: expect.any(String) }),
      slug: 'alice',
      userId: 'user-1',
    })
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('syncs providers even when instance just started', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({
      status: 'running',
      startedAt: new Date(),
    } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockSync).toHaveBeenCalledWith({
      instance: expect.objectContaining({ baseUrl: expect.any(String), authHeader: expect.any(String) }),
      slug: 'alice',
      userId: 'user-1',
    })
  })

  it('syncs providers against the workspace owner when admin opens another slug', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-alice' } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { slug: 'alice' }, select: { id: true } })
    expect(mockSync).toHaveBeenCalledWith({
      instance: expect.objectContaining({ baseUrl: expect.any(String), authHeader: expect.any(String) }),
      slug: 'alice',
      userId: 'user-alice',
    })
  })

  it('marks a restart as required when provider sync fails', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)
    mockSync.mockResolvedValue({ ok: false, error: 'sync_failed' } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockProviderUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { lastError: 'workspace_restart_required' },
    })
  })

  it('marks a restart as required when a running workspace has no connection', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)
    mockGetWorkspaceConnection.mockResolvedValueOnce(null)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockProviderUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { lastError: 'workspace_restart_required' },
    })
  })

  it('marks a restart as required when provider sync throws', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)
    mockSync.mockRejectedValueOnce(new Error('sync exploded'))

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockProviderUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { lastError: 'workspace_restart_required' },
    })
  })

  it('returns setup_required when kickstart is incomplete', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockGetKickstartStatus.mockResolvedValue('needs_setup')

    const result = await ensureInstanceRunningAction('alice')
    expect(result).toEqual({ status: 'error', error: 'setup_required' })
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it('returns running when a start call reports a ready runtime', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'stopped' } as never)
    mockStart.mockResolvedValue({ ok: true, status: 'started' } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockStart).toHaveBeenCalledWith('alice', 'user-1')
  })

  it('keeps starting when start reports a non-ready status', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'stopped' } as never)
    mockStart.mockResolvedValue({ ok: true, status: 'starting' } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'starting' })
  })

  it('returns starting when the workspace is already starting', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'starting' } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'starting' })
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('returns the start error detail when startup fails', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'stopped' } as never)
    mockStart.mockResolvedValue({ ok: false, error: 'start_failed', detail: 'podman failed' } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'error', error: 'podman failed' })
  })

  it('returns a structured error when startup checks throw unexpectedly', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockRejectedValue(new Error('boom'))

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'error', error: 'status_check_failed' })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock runtime session
vi.mock('@/lib/runtime/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: vi.fn(() => ({ containers: true })),
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

vi.mock('@/lib/services', () => ({
  auditService: { createEvent: vi.fn().mockResolvedValue(undefined) },
  userService: {
    findIdBySlug: vi.fn(),
  },
  providerService: {
    clearWorkspaceRestartRequired: vi.fn().mockResolvedValue({ count: 0 }),
    markWorkspaceRestartRequired: vi.fn().mockResolvedValue({ count: 0 }),
  },
}))

// Mock provider sync (imported by ensureInstanceRunningAction)
vi.mock('@/lib/harness/registry', () => ({
  syncRuntimeProviderAccess: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
}))

// Mock spawner core (only isSlowStart is still imported from here)
vi.mock('@/lib/spawner/core', () => ({
  startInstance: vi.fn(),
  isSlowStart: vi.fn(() => false),
  listActiveInstances: vi.fn(),
}))

vi.mock('@/lib/spawner/legacy-archive', () => ({
  isHistoryMigrationInProgress: vi.fn(),
}))

const mockGetKickstartStatus = vi.fn()
vi.mock('@/kickstart/status', () => ({
  getKickstartStatus: (...args: unknown[]) => mockGetKickstartStatus(...args),
}))

import { getSession } from '@/lib/runtime/session'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { startWorkspace, stopWorkspace, getWorkspaceStatus } from '@/lib/runtime/workspace-host'
import { syncRuntimeProviderAccess } from '@/lib/harness/registry'
import { auditService, providerService, userService } from '@/lib/services'
import { listActiveInstances, isSlowStart, startInstance } from '@/lib/spawner/core'
import { isHistoryMigrationInProgress } from '@/lib/spawner/legacy-archive'
import { startInstanceAction, startInstanceWithRuntimeAction, stopInstanceAction, getInstanceMigrationStatusAction, getInstanceStatusAction, ensureInstanceRunningAction, listActiveInstancesAction } from '@/actions/spawner'

const mockGetSession = vi.mocked(getSession)
const mockStart = vi.mocked(startWorkspace)
const mockStop = vi.mocked(stopWorkspace)
const mockStatus = vi.mocked(getWorkspaceStatus)
const mockUser = vi.mocked(userService)
const mockProvider = vi.mocked(providerService)
const mockSync = vi.mocked(syncRuntimeProviderAccess)
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
  mockSync.mockResolvedValue({ ok: true, data: undefined })
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

describe('startInstanceWithRuntimeAction', () => {
  it('requires a session', async () => {
    mockGetSession.mockResolvedValue(null)
    await expect(startInstanceWithRuntimeAction('alice', 'opencode-v2')).resolves.toEqual({ ok: false, error: 'unauthorized' })
    expect(startInstance).not.toHaveBeenCalled()
    expect(auditService.createEvent).not.toHaveBeenCalled()
  })

  it('rejects even the workspace owner unless they are admin', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    await expect(startInstanceWithRuntimeAction('alice', 'opencode-v2')).resolves.toEqual({ ok: false, error: 'forbidden' })
    expect(startInstance).not.toHaveBeenCalled()
    expect(auditService.createEvent).not.toHaveBeenCalled()
  })

  it('does not select a v2 desktop binary', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    vi.mocked(getRuntimeCapabilities).mockReturnValueOnce({ containers: false } as never)
    await expect(startInstanceWithRuntimeAction('alice', 'opencode-v2')).resolves.toEqual({ ok: false, error: 'runtime_unsupported' })
    expect(startInstance).not.toHaveBeenCalled()
  })

  it('rejects unknown kinds', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    await expect(startInstanceWithRuntimeAction('alice', 'unknown')).resolves.toEqual({ ok: false, error: 'runtime_unsupported' })
    expect(startInstance).not.toHaveBeenCalled()
  })

  it('requires setup to be ready', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    mockGetKickstartStatus.mockResolvedValue('needs_setup')
    await expect(startInstanceWithRuntimeAction('alice', 'opencode-v2')).resolves.toEqual({ ok: false, error: 'setup_required' })
    expect(startInstance).not.toHaveBeenCalled()
  })

  it.each([
    { ok: true, status: 'running' },
    { ok: false, error: 'runtime_unsupported' },
    { ok: false, error: 'already_running' },
  ] as const)('audits the explicit admin request and preserves the safe core result (%j)', async (result) => {
    mockGetSession.mockResolvedValue(adminSession)
    vi.mocked(startInstance).mockResolvedValueOnce(result)
    await expect(startInstanceWithRuntimeAction('alice', 'opencode-v2')).resolves.toEqual(result)
    expect(startInstance).toHaveBeenCalledWith('alice', 'admin-1', { runtimeKind: 'opencode-v2' })
    expect(auditService.createEvent).toHaveBeenCalledWith({
      actorUserId: 'admin-1', action: 'instance.runtime_start_requested', metadata: { slug: 'alice', runtimeKind: 'opencode-v2' },
    })
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('fails closed when audit recording fails', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    vi.mocked(auditService.createEvent).mockRejectedValueOnce(new Error('audit unavailable'))
    await expect(startInstanceWithRuntimeAction('alice', 'opencode-v2')).resolves.toEqual({ ok: false, error: 'start_failed' })
    expect(startInstance).not.toHaveBeenCalled()
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

describe('getInstanceMigrationStatusAction', () => {
  it('does not read progress without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    expect(await getInstanceMigrationStatusAction('alice')).toBeNull()
    expect(isHistoryMigrationInProgress).not.toHaveBeenCalled()
  })

  it('does not read another user workspace progress', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    expect(await getInstanceMigrationStatusAction('bob')).toBeNull()
    expect(isHistoryMigrationInProgress).not.toHaveBeenCalled()
  })

  it.each([true, false])('returns owner progress (%s) without contacting the runtime', async (migrating) => {
    mockGetSession.mockResolvedValue(fakeSession)
    vi.mocked(isHistoryMigrationInProgress).mockResolvedValueOnce(migrating)
    expect(await getInstanceMigrationStatusAction('alice')).toBe(migrating)
    expect(isHistoryMigrationInProgress).toHaveBeenCalledWith('alice')
    expect(mockStatus).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('allows admins to read another workspace progress', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    vi.mocked(isHistoryMigrationInProgress).mockResolvedValueOnce(true)
    expect(await getInstanceMigrationStatusAction('alice')).toBe(true)
  })

  it('returns unavailable rather than throwing when progress cannot be read', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    vi.mocked(isHistoryMigrationInProgress).mockRejectedValueOnce(new Error('read failed'))
    expect(await getInstanceMigrationStatusAction('alice')).toBeNull()
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

  it('returns running and refreshes provider access when instance is already running (own slug)', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockSync).toHaveBeenCalledWith('alice', { userId: 'user-1' })
    expect(mockUser.findIdBySlug).not.toHaveBeenCalled()
  })

  it('refreshes provider access even when instance just started', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({
      status: 'running',
      startedAt: new Date(),
    } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockSync).toHaveBeenCalledWith('alice', { userId: 'user-1' })
  })

  it('refreshes provider access against the workspace owner when admin opens another slug', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)
    mockUser.findIdBySlug.mockResolvedValue({ id: 'user-alice' })

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockUser.findIdBySlug).toHaveBeenCalledWith('alice')
    expect(mockSync).toHaveBeenCalledWith('alice', { userId: 'user-alice' })
  })

  it('marks a restart as required when provider sync fails', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)
    mockSync.mockResolvedValueOnce({ ok: false, error: { code: 'sync_failed' } })

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockProvider.markWorkspaceRestartRequired).toHaveBeenCalledWith('user-1')
  })

  it('marks a restart as required when a running workspace has no connection', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)
    mockSync.mockResolvedValueOnce({ ok: false, error: { code: 'instance_unavailable' } })

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockProvider.markWorkspaceRestartRequired).toHaveBeenCalledWith('user-1')
  })

  it('marks a restart as required when provider sync throws', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)
    mockSync.mockRejectedValueOnce(new Error('sync exploded'))

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockProvider.markWorkspaceRestartRequired).toHaveBeenCalledWith('user-1')
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

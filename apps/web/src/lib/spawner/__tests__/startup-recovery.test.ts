import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstanceRecord } from '@/lib/services/instance'
import { getStartTimeoutMs } from '@/lib/spawner/config'
import { getInstanceStatus, startInstance, stopInstance } from '@/lib/spawner/core'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), removeContainer: vi.fn(),
  createContainer: vi.fn(), health: vi.fn(), sync: vi.fn(), audit: vi.fn(),
  findLegacyArchiveSource: vi.fn(), stopContainer: vi.fn(), createArchiveContainer: vi.fn(),
  sourceStatus: vi.fn(), authHeaders: [] as string[],
  export: vi.fn(), migrationActive: false,
}))

vi.mock('@/lib/prisma', () => ({ prisma: { instance: mocks } }))
vi.mock('@/lib/services', async () => ({
  instanceService: await import('@/lib/services/instance'),
  auditService: { createEvent: mocks.audit }, providerService: { clearWorkspaceRestartRequired: vi.fn() }, userService: {},
}))
vi.mock('@/lib/harness/execution', () => ({}))
vi.mock('@/lib/harness/legacy-session-archive', () => ({ exportLegacySessions: mocks.export }))
vi.mock('@/lib/services/runtime-migration', () => ({ settleRuntimeMigratedRuns: async () => {} }))
vi.mock('@/lib/spawner/legacy-archive', () => ({
  isHistoryMigrationInProgress: async () => mocks.migrationActive,
  withHistoryMigrationProgress: async (_slug: string, work: () => Promise<unknown>) => {
    mocks.migrationActive = true
    try { return await work() } finally { mocks.migrationActive = false }
  },
}))
vi.mock('@/lib/spawner/crypto', () => ({ generatePassword: () => 'new', encryptPassword: (value: string) => `enc:${value}`, decryptPassword: (value: string) => value.slice(4) }))
vi.mock('@/lib/spawner/runtime-artifacts', () => ({
  buildWorkspaceRuntimeArtifacts: async () => ({ owner: null, opencodeConfigContent: '{}', skills: [] }),
  hashWorkspaceRuntimeArtifacts: () => 'hash', getWebProviderGatewayConfig: () => ({}),
}))
vi.mock('@/lib/harness/registry', () => ({
  CURRENT_RUNTIME_KIND: 'opencode-v2', DEFAULT_HEALTH_TIMEOUT_MS: 5_000,
  isCurrentRuntimeKind: (kind: string | null) => kind === 'opencode-v2',
  getRuntime: () => ({ health: mocks.health, syncProviderAccess: mocks.sync }),
  getRuntimeBaseUrl: () => 'http://opencode-alice:4096',
  getLegacySessionReader: (_slug: string, connection: { baseUrl: string; authHeader: string }) => {
    mocks.authHeaders.push(connection.authHeader)
    return {
      health: async () => ({ ok: true, data: {} }),
      sessionStatus: async () => connection.baseUrl === 'http://opencode-archive-alice:4096'
        ? { ok: true, data: {} }
        : connection.authHeader === `Basic ${Buffer.from('opencode:old').toString('base64')}`
          ? mocks.sourceStatus() : { ok: false, error: { code: 'http_status_401' } },
    }
  },
}))
vi.mock('@/lib/spawner/docker', () => ({
  hasLegacyBackendWriters: async () => false,
  removeOrphanedV2ContainerForSlug: async () => {}, removeManagedArchiveContainerForSlug: async () => {},
  findLegacyArchiveSource: mocks.findLegacyArchiveSource,
  stopContainer: mocks.stopContainer, createArchiveContainer: mocks.createArchiveContainer,
  removeContainer: mocks.removeContainer, removeManagedContainerForSlug: async () => {},
  createContainer: mocks.createContainer, startContainer: async () => {},
  isContainerRunning: async () => true, inspectContainer: async () => ({}),
}))

let current: InstanceRecord

beforeEach(() => {
  vi.resetAllMocks()
  mocks.migrationActive = false
  mocks.export.mockReset().mockResolvedValue({ ok: true, data: { archived: 1 } })
  mocks.authHeaders.length = 0
  current = {
    id: 'instance', slug: 'alice', status: 'running', containerId: 'legacy', runtimeKind: 'opencode-v1',
    createdAt: new Date(0), startedAt: new Date(1), stoppedAt: null, lastActivityAt: new Date(2),
    serverPassword: 'enc:old', appliedConfigSha: null, providerSyncHash: null, providerSyncedAt: null,
  }
  mocks.findUnique.mockImplementation(async () => ({ ...current }))
  const update = async ({ where, data }: { where: Partial<InstanceRecord>; data: Partial<InstanceRecord> }) => {
    const keys: (keyof InstanceRecord)[] = ['id', 'slug', 'status', 'containerId', 'runtimeKind', 'startedAt']
    const matches = keys.every((key) => {
      const expected = where[key]
      if (expected === undefined) return true
      const actual = current[key]
      return expected instanceof Date && actual instanceof Date ? expected.getTime() === actual.getTime() : expected === actual
    })
    if (!matches) return { count: 0 }
    current = { ...current, ...data }
    return { count: 1 }
  }
  mocks.updateMany.mockImplementation(update)
  mocks.update.mockImplementation(async (input: Parameters<typeof update>[0]) => {
    await update(input)
    return { ...current }
  })
  mocks.removeContainer.mockRejectedValueOnce(new Error('temporary removal failure')).mockResolvedValue(undefined)
  mocks.findLegacyArchiveSource.mockResolvedValue({ id: 'legacy', name: 'opencode-alice', running: true })
  mocks.sourceStatus.mockResolvedValue({ ok: true, data: {} })
  mocks.createArchiveContainer.mockResolvedValue({ id: 'archive', name: 'opencode-archive-alice' })
  mocks.createContainer.mockResolvedValue({ id: 'next' })
  mocks.stopContainer.mockResolvedValue(undefined)
  mocks.health.mockResolvedValue({ ok: true, data: {} })
  mocks.sync.mockResolvedValue({ ok: true, data: undefined })
})

afterEach(() => { vi.useRealTimers() })

describe('container attachment ownership', () => {
  it.each(['existing', 'fresh'])('cleans up a stale %s attempt without attaching to a newer container-free start', async (source) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-22T10:00:00Z'))
    current = { ...current, status: 'stopped', containerId: null, runtimeKind: 'opencode-v2' }
    if (source === 'fresh') mocks.findUnique.mockResolvedValueOnce(null)
    mocks.upsert.mockImplementation(async ({ create }: { create: Partial<InstanceRecord> }) => {
      current = { ...current, ...create }
      return { ...current }
    })
    mocks.removeContainer.mockReset().mockResolvedValue(undefined)
    const creating = Promise.withResolvers<void>()
    const created = Promise.withResolvers<{ id: string }>()
    mocks.createContainer.mockImplementationOnce(() => {
      creating.resolve()
      return created.promise
    })

    const starting = startInstance('alice', 'owner')
    await creating.promise
    const ownedStartedAt = current.startedAt
    await vi.advanceTimersByTimeAsync(1)
    current = { ...current, status: 'starting', startedAt: new Date(), serverPassword: 'enc:nxt' }
    const replacement = { ...current }
    created.resolve({ id: 'stale' })

    expect(await starting).toEqual({ ok: false, error: 'start_failed', detail: 'startup superseded by another attempt' })
    expect(current).toEqual(replacement)
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { slug: 'alice', status: 'starting', containerId: null, startedAt: ownedStartedAt },
      data: { containerId: 'stale', runtimeKind: 'opencode-v2' },
    })
    expect(mocks.stopContainer).toHaveBeenCalledExactlyOnceWith('stale')
    expect(mocks.removeContainer).toHaveBeenCalledExactlyOnceWith('stale')
    expect(mocks.health).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})

describe('legacy migration recovery', () => {
  it.each([
    ['export', 'legacy'], ['export', null], ['export', 'stale-pointer'],
    ['preparation', 'legacy'], ['preparation', null], ['preparation', 'stale-pointer'],
  ])('stops the owned source after %s failure with original pointer %s', async (failure, containerId) => {
    current = { ...current, containerId }
    mocks.removeContainer.mockReset().mockResolvedValue(undefined)
    if (failure === 'export') mocks.export.mockResolvedValueOnce({ ok: false, error: { code: 'runtime_error' } })
    else mocks.findLegacyArchiveSource.mockRejectedValueOnce(new Error('temporary discovery failure'))

    expect(await startInstance('alice', 'owner')).toEqual({
      ok: false, error: 'start_failed',
      detail: failure === 'export' ? 'legacy_archive_failed' : 'legacy_archive_preparation_failed',
    })
    expect(current).toMatchObject({ status: 'error', runtimeKind: 'opencode-v1', serverPassword: 'enc:old' })
    expect(mocks.stopContainer).not.toHaveBeenCalled()
    expect(mocks.removeContainer).not.toHaveBeenCalled()

    mocks.stopContainer.mockImplementationOnce(async () => { expect(current.status).toBe('starting') })
    mocks.removeContainer.mockImplementationOnce(async () => { expect(current.status).toBe('starting') })
    expect(await stopInstance('alice', 'owner')).toEqual({ ok: true, status: 'stopped' })
    expect(mocks.findLegacyArchiveSource).toHaveBeenLastCalledWith('alice', null)
    expect(mocks.stopContainer).toHaveBeenCalledExactlyOnceWith('legacy')
    expect(mocks.removeContainer).toHaveBeenCalledExactlyOnceWith('legacy')
    expect(current).toMatchObject({ status: 'stopped', containerId: null })
  })

  it.each([null, 'stale-pointer'])('resolves the owned source before stopping a legacy instance with pointer %s', async (containerId) => {
    current = { ...current, containerId, runtimeKind: null }
    mocks.removeContainer.mockReset().mockResolvedValue(undefined)
    expect(await stopInstance('alice', 'owner')).toEqual({ ok: true, status: 'stopped' })
    expect(mocks.findLegacyArchiveSource).toHaveBeenCalledExactlyOnceWith('alice', containerId)
    expect(mocks.stopContainer).toHaveBeenCalledExactlyOnceWith('legacy')
    expect(mocks.removeContainer).toHaveBeenCalledExactlyOnceWith('legacy')
  })

  it.each(['discovery', 'removal'])('keeps a pointerless legacy shutdown retryable after %s failure', async (failure) => {
    current = { ...current, status: 'error', containerId: null }
    const original = { ...current }
    mocks.removeContainer.mockReset().mockResolvedValue(undefined)
    if (failure === 'discovery') mocks.findLegacyArchiveSource.mockRejectedValueOnce(new Error('ownership unconfirmed'))
    else mocks.removeContainer.mockRejectedValueOnce(new Error('removal unconfirmed'))

    expect(await stopInstance('alice', 'owner')).toEqual({ ok: false, error: 'stop_failed' })
    expect(current).toEqual(original)
    expect(await stopInstance('alice', 'owner')).toEqual({ ok: true, status: 'stopped' })
    expect(mocks.removeContainer).toHaveBeenLastCalledWith('legacy')
    expect(current).toMatchObject({ status: 'stopped', containerId: null })
  })

  it('retains long-running archive ownership through status polling and competing starts', async () => {
    vi.useFakeTimers()
    current = { ...current, status: 'stopped', startedAt: null, containerId: null }
    mocks.removeContainer.mockReset().mockResolvedValue(undefined)
    mocks.findLegacyArchiveSource.mockResolvedValue(null)
    const release = Promise.withResolvers<void>()
    mocks.export.mockImplementationOnce(async () => {
      await release.promise
      return { ok: true, data: { archived: 40 } }
    })
    const starting = startInstance('alice', 'owner')
    await vi.waitFor(() => expect(mocks.export).toHaveBeenCalled())
    try {
      await vi.advanceTimersByTimeAsync(getStartTimeoutMs() * 2 + 1)
      expect(await getInstanceStatus('alice')).toMatchObject({ status: 'starting', containerId: null })
      expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'already_running' })
      expect(mocks.createArchiveContainer).toHaveBeenCalledOnce()
      expect(mocks.removeContainer).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      await starting
    }
    expect(await starting).toEqual({ ok: true, status: 'running' })
  })

  it('still recovers an abandoned legacy startup without active migration progress', async () => {
    current = { ...current, status: 'starting', startedAt: new Date(Date.now() - getStartTimeoutMs() * 3) }
    mocks.removeContainer.mockReset().mockResolvedValue(undefined)
    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
  })

  it('lets the owner explicitly stop a busy legacy workspace and archive through a fresh idle helper', async () => {
    mocks.removeContainer.mockReset().mockResolvedValue(undefined)
    mocks.sourceStatus.mockResolvedValue({ ok: true, data: { active: { type: 'busy' } } })

    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'start_failed', detail: 'legacy_archive_busy' })
    expect(current).toMatchObject({ status: 'running', runtimeKind: 'opencode-v1', serverPassword: 'enc:old', containerId: 'legacy' })
    expect(mocks.stopContainer).not.toHaveBeenCalled()
    expect(mocks.removeContainer).not.toHaveBeenCalled()

    expect(await stopInstance('alice', 'owner')).toEqual({ ok: true, status: 'stopped' })
    expect(mocks.stopContainer).toHaveBeenCalledExactlyOnceWith('legacy')
    expect(mocks.removeContainer).toHaveBeenCalledWith('legacy')
    expect(current).toMatchObject({ status: 'stopped', runtimeKind: 'opencode-v1', serverPassword: 'enc:old', containerId: null })

    mocks.findLegacyArchiveSource.mockResolvedValue(null)
    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
    expect(mocks.createArchiveContainer).toHaveBeenCalledExactlyOnceWith('alice', 'new')
    expect(mocks.removeContainer).toHaveBeenCalledWith('archive')
    expect(mocks.sourceStatus).toHaveBeenCalledOnce()
    expect(current).toMatchObject({ status: 'running', runtimeKind: 'opencode-v2', containerId: 'next' })
  })

  it('retries a failed teardown using the original live source credentials before rotating them', async () => {
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'start_failed', detail: 'legacy_archive_cleanup_failed' })
    expect(current).toMatchObject({ status: 'error', runtimeKind: 'opencode-v1', serverPassword: 'enc:old' })

    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
    expect(current).toMatchObject({ status: 'running', runtimeKind: 'opencode-v2', serverPassword: 'enc:new', containerId: 'next' })
    expect(mocks.authHeaders).toEqual(Array(2).fill(`Basic ${Buffer.from('opencode:old').toString('base64')}`))
  })
})

describe('fresh workspace runtime kind', () => {
  it('retries a failed first start on the current runtime instead of the legacy archive path', async () => {
    current = { ...current, status: 'stopped', containerId: null, runtimeKind: null }
    mocks.findUnique.mockResolvedValueOnce(null)
    mocks.upsert.mockImplementation(async ({ create }: { create: Partial<InstanceRecord> }) => {
      current = { ...current, ...create }
      return { ...current }
    })
    mocks.removeContainer.mockReset().mockResolvedValue(undefined)
    mocks.createContainer.mockRejectedValueOnce(new Error('registry unavailable'))

    expect(await startInstance('alice', 'owner')).toMatchObject({ ok: false, error: 'start_failed' })
    expect(current).toMatchObject({ status: 'error', runtimeKind: 'opencode-v2' })

    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
    expect(mocks.findLegacyArchiveSource).not.toHaveBeenCalled()
    expect(mocks.createArchiveContainer).not.toHaveBeenCalled()
    expect(mocks.export).not.toHaveBeenCalled()
    expect(current).toMatchObject({ status: 'running', runtimeKind: 'opencode-v2', containerId: 'next' })
  })
})

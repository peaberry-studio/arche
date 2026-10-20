import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeRuntime } from '@/lib/harness/__tests__/fake-runtime'
import { exportLegacySessions } from '@/lib/harness/legacy-session-archive'
import { getRuntimeForKind } from '@/lib/harness/registry'
import { instanceService } from '@/lib/services'
import type { InstanceRecord } from '@/lib/services/instance'
import { settleRuntimeMigratedRuns } from '@/lib/services/runtime-migration'
import { getInstanceStatus, startInstance, stopInstance } from '@/lib/spawner/core'
import * as docker from '@/lib/spawner/docker'

const mocks = vi.hoisted(() => ({ ready: vi.fn(), v1: vi.fn(), v2: vi.fn(), abort: vi.fn() }))
vi.mock('@/lib/harness/execution', () => ({ abortSessionFamilyAndConfirmIdle: mocks.abort }))
vi.mock('@/lib/harness/legacy-session-archive', () => ({ exportLegacySessions: vi.fn() }))
vi.mock('@/lib/services/runtime-migration', () => ({ settleRuntimeMigratedRuns: vi.fn() }))
vi.mock('@/lib/spawner/legacy-archive', () => ({ withHistoryMigrationProgress: (_slug: string, work: () => Promise<unknown>) => work() }))
vi.mock('@/lib/services', () => ({
  instanceService: {
    findBySlug: vi.fn(), findStatusBySlug: vi.fn(), claimStartingTransition: vi.fn(), continueStartingTransition: vi.fn(), failStartingTransition: vi.fn(), finishStoppingTransition: vi.fn(), upsertStarting: vi.fn(),
    setContainerId: vi.fn(), setRunningIfCurrentContainer: vi.fn(), setError: vi.fn(),
  },
  auditService: { createEvent: vi.fn() }, userService: {},
  providerService: { markWorkspaceRestartRequired: vi.fn(), clearWorkspaceRestartRequired: vi.fn() },
}))
vi.mock('@/lib/harness/registry', () => ({
  getRuntimeForKind: vi.fn(), checkRuntimeStartupSupport: mocks.ready,
  getRuntimeBaseUrl: () => 'http://opencode-alice:4096', DEFAULT_HEALTH_TIMEOUT_MS: 5000,
}))
vi.mock('@/lib/spawner/docker', () => ({
  createArchiveContainer: vi.fn(), createContainer: vi.fn(), startContainer: vi.fn(), removeContainer: vi.fn(),
  removeManagedContainerForSlug: vi.fn(), isContainerRunning: vi.fn(), inspectContainer: vi.fn(),
  removeManagedArchiveContainerForSlug: vi.fn(),
  stopContainer: vi.fn(),
}))
vi.mock('@/lib/spawner/crypto', () => ({ generatePassword: () => 'test-only', encryptPassword: () => 'encrypted', decryptPassword: () => 'previous' }))
vi.mock('@/lib/spawner/runtime-artifacts', () => ({
  buildWorkspaceRuntimeArtifacts: vi.fn().mockResolvedValue({ owner: null, opencodeConfigContent: '{}', agentsMd: '', skills: [] }),
  hashWorkspaceRuntimeArtifacts: () => 'hash', getWebProviderGatewayConfig: () => ({}),
}))

function legacyInstance(runtimeKind: string | null = 'opencode-v1'): InstanceRecord {
  return {
    id: 'instance', slug: 'alice', status: 'stopped', createdAt: new Date(0), startedAt: null, stoppedAt: new Date(0),
    lastActivityAt: null, containerId: 'legacy', serverPassword: 'encrypted', runtimeKind, appliedConfigSha: null,
    providerSyncHash: null, providerSyncedAt: null,
  }
}

describe('archive-on-start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.v1.mockReturnValue(fakeRuntime())
    mocks.v2.mockReturnValue({ ...fakeRuntime(), kind: 'opencode-v2' })
    vi.mocked(getRuntimeForKind).mockImplementation((_slug, kind) => ({ ok: true, data: kind === 'opencode-v2' ? mocks.v2() : mocks.v1() }))
    mocks.ready.mockReturnValue({ ok: true, data: undefined })
    mocks.abort.mockResolvedValue(true)
    vi.mocked(instanceService.findBySlug).mockResolvedValue(legacyInstance())
    vi.mocked(instanceService.claimStartingTransition).mockResolvedValue({ count: 1 })
    vi.mocked(instanceService.continueStartingTransition).mockResolvedValue({ count: 1 })
    vi.mocked(instanceService.setRunningIfCurrentContainer).mockResolvedValue({ count: 1 })
    vi.mocked(docker.isContainerRunning).mockResolvedValue(true)
    vi.mocked(docker.inspectContainer).mockRejectedValue(new Error('DNS-only fixture'))
    vi.mocked(docker.createArchiveContainer).mockResolvedValue({ id: 'archive', name: 'opencode-archive-alice-attempt' })
    vi.mocked(docker.createContainer).mockResolvedValue({ id: 'next' } as Awaited<ReturnType<typeof docker.createContainer>>)
    vi.mocked(docker.removeContainer).mockResolvedValue(undefined)
    vi.mocked(docker.stopContainer).mockResolvedValue(undefined)
    vi.mocked(docker.removeManagedArchiveContainerForSlug).mockResolvedValue(undefined)
    vi.mocked(exportLegacySessions).mockResolvedValue({ ok: true, data: { archived: 40 } })
    vi.mocked(settleRuntimeMigratedRuns).mockResolvedValue(undefined)
  })

  it.each(['opencode-v1', null])('exports a still-running legacy container (%s) before creating V2', async (kind) => {
    vi.mocked(instanceService.findBySlug).mockResolvedValue(legacyInstance(kind))
    expect(await startInstance('alice', 'owner', { runtimeKind: 'opencode-v2' })).toEqual({ ok: true, status: 'running' })
    expect(exportLegacySessions).toHaveBeenCalledWith('alice', expect.objectContaining({ kind: 'opencode-v1' }))
    expect(docker.createArchiveContainer).not.toHaveBeenCalled()
    expect(getRuntimeForKind).toHaveBeenCalledWith('alice', 'opencode-v1', expect.objectContaining({ baseUrl: 'http://opencode-alice:4096', signal: expect.any(AbortSignal) }))
    expect(vi.mocked(exportLegacySessions).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(docker.createContainer).mock.invocationCallOrder[0])
    expect(vi.mocked(settleRuntimeMigratedRuns).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(docker.createContainer).mock.invocationCallOrder[0])
    expect(docker.createContainer).toHaveBeenCalledWith('alice', 'test-only', '{}', '', [], expect.anything(), 'opencode-v2')
    expect(instanceService.setContainerId).toHaveBeenCalledWith('alice', 'next', 'opencode-v2')
  })

  it('boots an isolated archive container for stopped V1 and removes it before switching', async () => {
    vi.mocked(docker.isContainerRunning).mockImplementation(async (id) => id !== 'legacy')
    await startInstance('alice', 'owner', { runtimeKind: 'opencode-v2' })
    expect(docker.createArchiveContainer).toHaveBeenCalledWith('alice', 'test-only')
    expect(docker.startContainer).toHaveBeenCalledWith('archive')
    expect(getRuntimeForKind).toHaveBeenCalledWith('alice', 'opencode-v1', expect.objectContaining({ baseUrl: 'http://opencode-archive-alice-attempt:4096' }))
    const cleanup = vi.mocked(docker.removeContainer).mock.calls.findIndex(([id]) => id === 'archive')
    expect(vi.mocked(docker.removeContainer).mock.invocationCallOrder[cleanup]).toBeLessThan(vi.mocked(docker.createContainer).mock.invocationCallOrder[0])
  })

  it('falls back to V1 without settling runs when export fails', async () => {
    vi.mocked(exportLegacySessions).mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })
    expect(await startInstance('alice', 'owner', { runtimeKind: 'opencode-v2' })).toEqual({ ok: true, status: 'running' })
    expect(docker.createContainer).toHaveBeenCalledWith('alice', 'test-only', '{}', '', [], expect.anything(), 'opencode-v1')
    expect(instanceService.setContainerId).toHaveBeenCalledWith('alice', 'next', 'opencode-v1')
    expect(settleRuntimeMigratedRuns).not.toHaveBeenCalled()
  })

  it('does not switch if a legacy run cannot be confirmed idle', async () => {
    const v1 = fakeRuntime()
    v1.sessionStatus.mockResolvedValue({ ok: true, data: { busy: { type: 'busy' } } })
    mocks.v1.mockReturnValue(v1)
    mocks.abort.mockResolvedValue(false)
    await startInstance('alice', 'owner', { runtimeKind: 'opencode-v2' })
    expect(exportLegacySessions).not.toHaveBeenCalled()
    expect(docker.createContainer).toHaveBeenCalledWith('alice', 'test-only', '{}', '', [], expect.anything(), 'opencode-v1')
  })

  it('refuses all migration effects while V2 startup remains blocked', async () => {
    mocks.ready.mockReturnValue({ ok: false, error: { code: 'runtime_unsupported', detail: 'v2_startup_unverified' } })
    expect(await startInstance('alice', 'owner', { runtimeKind: 'opencode-v2' })).toMatchObject({ ok: false, error: 'runtime_unsupported' })
    expect(instanceService.claimStartingTransition).not.toHaveBeenCalled()
    expect(exportLegacySessions).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()
  })

  it('does not touch containers when another startup wins the migration claim', async () => {
    vi.mocked(instanceService.claimStartingTransition).mockResolvedValue({ count: 0 })
    expect(await startInstance('alice', 'owner', { runtimeKind: 'opencode-v2' })).toEqual({ ok: false, error: 'already_running' })
    expect(exportLegacySessions).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()
  })

  it('does not stop or allow a second start while an archive startup owns the instance', async () => {
    vi.mocked(instanceService.findBySlug).mockResolvedValue({ ...legacyInstance(), status: 'starting', startedAt: new Date() })
    expect(await stopInstance('alice', 'owner')).toEqual({ ok: false, error: 'stop_failed' })
    expect(await startInstance('alice', 'owner', { runtimeKind: 'opencode-v1' })).toEqual({ ok: false, error: 'already_running' })
    expect(docker.removeContainer).not.toHaveBeenCalled()
    expect(docker.createContainer).not.toHaveBeenCalled()
  })

  it('does not publish stopped when neither stop nor removal confirmed termination', async () => {
    vi.mocked(instanceService.findBySlug).mockResolvedValue({ ...legacyInstance(), status: 'running' })
    vi.mocked(docker.stopContainer).mockRejectedValue(new Error('stop failed'))
    vi.mocked(docker.removeContainer).mockRejectedValue(new Error('remove failed'))
    expect(await stopInstance('alice', 'owner')).toEqual({ ok: false, error: 'stop_failed' })
    expect(instanceService.finishStoppingTransition).not.toHaveBeenCalled()
  })

  it('retains the startup lease throughout an in-flight export and helper cleanup', async () => {
    vi.mocked(exportLegacySessions).mockImplementation(async () => {
      vi.mocked(instanceService.findBySlug).mockResolvedValue({ ...legacyInstance(), status: 'starting', startedAt: new Date() })
      expect(await stopInstance('alice', 'owner')).toEqual({ ok: false, error: 'stop_failed' })
      expect(await startInstance('alice', 'owner', { runtimeKind: 'opencode-v1' })).toEqual({ ok: false, error: 'already_running' })
      expect(docker.removeManagedContainerForSlug).not.toHaveBeenCalled()
      return { ok: true, data: { archived: 40 } }
    })
    expect(await startInstance('alice', 'owner', { runtimeKind: 'opencode-v2' })).toEqual({ ok: true, status: 'running' })
    expect(instanceService.continueStartingTransition).toHaveBeenCalledOnce()
    expect(docker.createContainer).toHaveBeenCalledOnce()
  })

  it('does not tear down a replacement or settle runs after losing migration ownership', async () => {
    vi.mocked(instanceService.continueStartingTransition).mockResolvedValue({ count: 0 })
    expect(await startInstance('alice', 'owner', { runtimeKind: 'opencode-v2' })).toEqual({ ok: false, error: 'already_running' })
    expect(docker.removeContainer).not.toHaveBeenCalled()
    expect(docker.removeManagedContainerForSlug).not.toHaveBeenCalled()
    expect(docker.createContainer).not.toHaveBeenCalled()
    expect(settleRuntimeMigratedRuns).not.toHaveBeenCalled()
  })

  it('does not mount a legacy volume again when archive container removal failed', async () => {
    vi.mocked(docker.isContainerRunning).mockImplementation(async (id) => id !== 'legacy')
    vi.mocked(docker.removeContainer).mockRejectedValue(new Error('remove failed'))
    expect(await startInstance('alice', 'owner', { runtimeKind: 'opencode-v2' })).toMatchObject({ ok: false, error: 'start_failed' })
    expect(docker.createContainer).not.toHaveBeenCalled()
    expect(settleRuntimeMigratedRuns).not.toHaveBeenCalled()
  })

  it('refuses a V1 retry until the managed archive helper is confirmed removed', async () => {
    vi.mocked(docker.removeManagedArchiveContainerForSlug).mockRejectedValue(new Error('helper still running'))
    expect(await startInstance('alice', 'owner', { runtimeKind: 'opencode-v1' })).toEqual({ ok: false, error: 'start_failed', detail: 'legacy_archive_cleanup_failed' })
    expect(docker.createContainer).not.toHaveBeenCalled()
    expect(docker.removeManagedContainerForSlug).not.toHaveBeenCalled()
    expect(instanceService.failStartingTransition).toHaveBeenCalled()
  })

  it('keeps fresh startup status while history export has no serving container', async () => {
    vi.mocked(instanceService.findStatusBySlug).mockResolvedValue({ ...legacyInstance(), status: 'starting', startedAt: new Date(), containerId: null })
    expect(await getInstanceStatus('alice')).toMatchObject({ status: 'starting', containerId: null })
    expect(docker.isContainerRunning).not.toHaveBeenCalled()
  })

  it('does not re-export when restarting V2 or rolling back to V1', async () => {
    vi.mocked(instanceService.findBySlug).mockResolvedValue(legacyInstance('opencode-v2'))
    await startInstance('alice', 'owner', { runtimeKind: 'opencode-v1' })
    expect(exportLegacySessions).not.toHaveBeenCalled()
    expect(settleRuntimeMigratedRuns).not.toHaveBeenCalled()
    expect(docker.createContainer).toHaveBeenCalledWith('alice', 'test-only', '{}', '', [], expect.anything(), 'opencode-v1')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeRuntime } from '@/lib/harness/__tests__/fake-runtime'
import { exportLegacySessions } from '@/lib/harness/legacy-session-archive'
import { getLegacySessionReader, getRuntime } from '@/lib/harness/registry'
import { instanceService } from '@/lib/services'
import type { InstanceRecord } from '@/lib/services/instance'
import { settleRuntimeMigratedRuns } from '@/lib/services/runtime-migration'
import { getInstanceStatus, startInstance, stopInstance } from '@/lib/spawner/core'
import * as docker from '@/lib/spawner/docker'

const mocks = vi.hoisted(() => ({ abort: vi.fn() }))
vi.mock('@/lib/harness/execution', () => ({ abortSessionFamilyAndConfirmIdle: mocks.abort }))
vi.mock('@/lib/harness/legacy-session-archive', () => ({ exportLegacySessions: vi.fn() }))
vi.mock('@/lib/services/runtime-migration', () => ({ settleRuntimeMigratedRuns: vi.fn() }))
vi.mock('@/lib/spawner/legacy-archive', () => ({ withHistoryMigrationProgress: (_slug: string, work: () => Promise<unknown>) => work() }))
vi.mock('@/lib/services', () => ({
  instanceService: {
    findBySlug: vi.fn(), findStatusBySlug: vi.fn(), claimStartingTransition: vi.fn(), continueStartingTransition: vi.fn(), setStartingPassword: vi.fn(), failStartingTransition: vi.fn(), finishStoppingTransition: vi.fn(), upsertStarting: vi.fn(),
    setContainerId: vi.fn(), setRunningIfCurrentContainer: vi.fn(), setError: vi.fn(), recoverStoppingTransition: vi.fn(),
  },
  auditService: { createEvent: vi.fn() }, userService: {},
  providerService: { markWorkspaceRestartRequired: vi.fn(), clearWorkspaceRestartRequired: vi.fn() },
}))
vi.mock('@/lib/harness/registry', () => ({
  getRuntime: vi.fn(), getLegacySessionReader: vi.fn(),
  CURRENT_RUNTIME_KIND: 'opencode-v2', isCurrentRuntimeKind: (kind: string | null) => kind === 'opencode-v2',
  getRuntimeBaseUrl: () => 'http://opencode-alice:4096', DEFAULT_HEALTH_TIMEOUT_MS: 5000,
}))
vi.mock('@/lib/spawner/docker', () => ({
  hasLegacyBackendWriters: vi.fn().mockResolvedValue(false),
  removeOrphanedV2ContainerForSlug: vi.fn().mockResolvedValue(undefined),
  createArchiveContainer: vi.fn(), createContainer: vi.fn(), startContainer: vi.fn(), removeContainer: vi.fn(),
  removeManagedContainerForSlug: vi.fn(), isContainerRunning: vi.fn(), inspectContainer: vi.fn(),
  removeManagedArchiveContainerForSlug: vi.fn(),
  stopContainer: vi.fn(), findLegacyArchiveSource: vi.fn(),
}))
vi.mock('@/lib/spawner/crypto', () => ({ generatePassword: () => 'test-only', encryptPassword: () => 'encrypted', decryptPassword: () => 'previous' }))
vi.mock('@/lib/spawner/runtime-artifacts', () => ({
  buildWorkspaceRuntimeArtifacts: vi.fn().mockResolvedValue({ owner: null, opencodeConfigContent: '{}', agentsMd: '', skills: [] }),
  hashWorkspaceRuntimeArtifacts: () => 'hash', getWebProviderGatewayConfig: () => ({}),
}))

function legacyInstance(runtimeKind: string | null = 'opencode-v1'): InstanceRecord {
  return {
    id: 'instance', slug: 'alice', status: 'stopped', createdAt: new Date(0), startedAt: null, stoppedAt: new Date(0),
    lastActivityAt: null, containerId: 'legacy', serverPassword: 'enc', runtimeKind, appliedConfigSha: null,
    providerSyncHash: null, providerSyncedAt: null,
  }
}

describe('archive-on-start', () => {
  let reader: ReturnType<typeof fakeRuntime>

  beforeEach(() => {
    vi.clearAllMocks()
    reader = fakeRuntime()
    vi.mocked(getLegacySessionReader).mockReturnValue(reader)
    vi.mocked(getRuntime).mockReturnValue({ ...fakeRuntime(), kind: 'opencode-v2' })
    mocks.abort.mockResolvedValue(true)
    vi.mocked(instanceService.findBySlug).mockResolvedValue(legacyInstance())
    vi.mocked(instanceService.claimStartingTransition).mockResolvedValue({ count: 1 })
    vi.mocked(instanceService.continueStartingTransition).mockResolvedValue({ count: 1 })
    vi.mocked(instanceService.setStartingPassword).mockResolvedValue({ count: 1 })
    vi.mocked(instanceService.setRunningIfCurrentContainer).mockResolvedValue({ count: 1 })
    vi.mocked(instanceService.recoverStoppingTransition).mockResolvedValue({ count: 1 })
    vi.mocked(docker.findLegacyArchiveSource).mockResolvedValue({ id: 'legacy', name: 'opencode-alice', running: true })
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
    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
    expect(exportLegacySessions).toHaveBeenCalledWith('alice', reader)
    expect(docker.createArchiveContainer).not.toHaveBeenCalled()
    expect(getLegacySessionReader).toHaveBeenCalledWith('alice', expect.objectContaining({ baseUrl: 'http://opencode-alice:4096', signal: expect.any(AbortSignal) }))
    expect(vi.mocked(exportLegacySessions).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(docker.createContainer).mock.invocationCallOrder[0])
    expect(vi.mocked(settleRuntimeMigratedRuns).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(docker.createContainer).mock.invocationCallOrder[0])
    expect(docker.createContainer).toHaveBeenCalledWith('alice', 'test-only', '{}', '', [], expect.anything())
    expect(instanceService.setContainerId).toHaveBeenCalledWith('alice', 'next', 'opencode-v2')
  })

  it('migrates a workspace still running OpenCode 1 instead of reporting it already running', async () => {
    vi.mocked(instanceService.findBySlug).mockResolvedValue({ ...legacyInstance(), status: 'running' })
    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
    expect(instanceService.claimStartingTransition).toHaveBeenCalledOnce()
    expect(docker.createArchiveContainer).not.toHaveBeenCalled()
    expect(getLegacySessionReader).toHaveBeenCalledWith('alice', expect.objectContaining({ baseUrl: 'http://opencode-alice:4096' }))
    expect(exportLegacySessions).toHaveBeenCalledWith('alice', reader)
    expect(vi.mocked(docker.removeContainer).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(docker.createContainer).mock.invocationCallOrder[0])
    expect(docker.removeContainer).toHaveBeenCalledWith('legacy')
    expect(instanceService.setContainerId).toHaveBeenCalledWith('alice', 'next', 'opencode-v2')
  })

  it('reports a running OpenCode 2 workspace as already running', async () => {
    vi.mocked(instanceService.findBySlug).mockResolvedValue({ ...legacyInstance('opencode-v2'), status: 'running' })
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'already_running' })
    expect(instanceService.claimStartingTransition).not.toHaveBeenCalled()
    expect(exportLegacySessions).not.toHaveBeenCalled()
  })

  it('boots an isolated archive container for stopped V1 and removes it before switching', async () => {
    vi.mocked(docker.findLegacyArchiveSource).mockResolvedValue({ id: 'legacy', name: 'opencode-alice', running: false })
    await startInstance('alice', 'owner')
    expect(docker.createArchiveContainer).toHaveBeenCalledWith('alice', 'test-only')
    expect(docker.startContainer).toHaveBeenCalledWith('archive')
    expect(vi.mocked(docker.removeContainer).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(docker.createArchiveContainer).mock.invocationCallOrder[0])
    expect(getLegacySessionReader).toHaveBeenCalledWith('alice', expect.objectContaining({ baseUrl: 'http://opencode-archive-alice-attempt:4096' }))
    const cleanup = vi.mocked(docker.removeContainer).mock.calls.findIndex(([id]) => id === 'archive')
    expect(vi.mocked(docker.removeContainer).mock.invocationCallOrder[cleanup]).toBeLessThan(vi.mocked(docker.createContainer).mock.invocationCallOrder[0])
  })

  it.each([null, 'stale-pointer'])('uses the discovered owned source with DB pointer %s, never a helper', async (containerId) => {
    vi.mocked(instanceService.findBySlug).mockResolvedValue({ ...legacyInstance(), containerId })
    vi.mocked(docker.findLegacyArchiveSource).mockResolvedValue({ id: 'discovered', name: 'renamed-alice', running: true })
    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
    expect(docker.findLegacyArchiveSource).toHaveBeenCalledWith('alice', containerId)
    expect(docker.createArchiveContainer).not.toHaveBeenCalled()
    expect(getLegacySessionReader).toHaveBeenCalledWith('alice', expect.objectContaining({ baseUrl: 'http://renamed-alice:4096' }))
    expect(docker.removeContainer).toHaveBeenCalledWith('discovered')
    expect(vi.mocked(docker.removeContainer).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(docker.createContainer).mock.invocationCallOrder[0])
  })

  it('starts a helper only after source absence is confirmed', async () => {
    vi.mocked(docker.findLegacyArchiveSource).mockResolvedValue(null)
    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
    expect(vi.mocked(docker.findLegacyArchiveSource).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(docker.createArchiveContainer).mock.invocationCallOrder[0])
  })

  it.each(['proxy down', 'ambiguous ownership', 'multiple sources'])('fails closed before helper or fallback startup when source discovery fails: %s', async (message) => {
    vi.mocked(docker.findLegacyArchiveSource).mockRejectedValue(new Error(message))
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'start_failed', detail: 'legacy_archive_preparation_failed' })
    expect(docker.createArchiveContainer).not.toHaveBeenCalled()
    expect(docker.createContainer).not.toHaveBeenCalled()
    expect(exportLegacySessions).not.toHaveBeenCalled()
  })

  it('does not start any runtime if a discovered source cannot be removed after export', async () => {
    vi.mocked(docker.removeContainer).mockRejectedValue(new Error('source still running'))
    expect(await startInstance('alice', 'owner')).toMatchObject({ ok: false, error: 'start_failed' })
    expect(docker.createContainer).not.toHaveBeenCalled()
    expect(instanceService.continueStartingTransition).toHaveBeenCalledWith(legacyInstance(), expect.any(Date), 'enc', expect.any(Date))
    expect(instanceService.setStartingPassword).not.toHaveBeenCalled()
  })

  it('rotates legacy credentials only after the source was removed', async () => {
    await startInstance('alice', 'owner')
    expect(instanceService.setStartingPassword).toHaveBeenCalledWith('alice', expect.any(Date), 'encrypted')
    expect(vi.mocked(docker.removeContainer).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(instanceService.setStartingPassword).mock.invocationCallOrder[0])
    expect(vi.mocked(instanceService.setStartingPassword).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(docker.createContainer).mock.invocationCallOrder[0])
  })

  it('re-exports legacy history after reclaiming a V2 container orphaned before its DB write', async () => {
    let orphanRemoved = false
    vi.mocked(docker.removeOrphanedV2ContainerForSlug).mockImplementationOnce(async () => { orphanRemoved = true })
    vi.mocked(docker.findLegacyArchiveSource).mockImplementationOnce(async () => {
      if (!orphanRemoved) throw new Error('legacy_archive_source_not_owned_v1')
      return null
    })
    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
    expect(exportLegacySessions).toHaveBeenCalledOnce()
    expect(docker.createArchiveContainer).toHaveBeenCalledOnce()
    expect(docker.createContainer).toHaveBeenCalledOnce()
  })

  it('preserves the source credentials if settling legacy runs fails before teardown', async () => {
    vi.mocked(settleRuntimeMigratedRuns).mockRejectedValueOnce(new Error('database unavailable'))
    expect(await startInstance('alice', 'owner')).toMatchObject({ ok: false, error: 'start_failed' })
    expect(instanceService.continueStartingTransition).toHaveBeenCalledWith(legacyInstance(), expect.any(Date), 'enc', expect.any(Date))
    expect(instanceService.setStartingPassword).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()
  })

  it.each(['legacy', 'inventory'] as const)('does not mutate legacy state before old backend writers are drained (%s)', async (reason) => {
    if (reason === 'legacy') vi.mocked(docker.hasLegacyBackendWriters).mockResolvedValueOnce(true)
    else vi.mocked(docker.hasLegacyBackendWriters).mockRejectedValueOnce(new Error('inventory unavailable'))
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'runtime_upgrade_pending' })
    expect(instanceService.claimStartingTransition).not.toHaveBeenCalled()
    expect(settleRuntimeMigratedRuns).not.toHaveBeenCalled()
    expect(exportLegacySessions).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()
    expect(docker.createContainer).not.toHaveBeenCalled()
  })

  it('never starts a helper if the stopped source could not be removed', async () => {
    vi.mocked(docker.findLegacyArchiveSource).mockResolvedValue({ id: 'legacy', name: 'opencode-alice', running: false })
    vi.mocked(docker.removeContainer).mockRejectedValue(new Error('removal unconfirmed'))
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'start_failed', detail: 'legacy_archive_preparation_failed' })
    expect(docker.createArchiveContainer).not.toHaveBeenCalled()
    expect(docker.createContainer).not.toHaveBeenCalled()
  })

  it('fails the start and keeps the legacy state for a retry when export fails', async () => {
    vi.mocked(exportLegacySessions).mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'start_failed', detail: 'legacy_archive_failed' })
    expect(instanceService.failStartingTransition).toHaveBeenCalledWith('instance', expect.any(Date))
    expect(instanceService.continueStartingTransition).not.toHaveBeenCalled()
    expect(docker.removeManagedContainerForSlug).not.toHaveBeenCalled()
    expect(docker.createContainer).not.toHaveBeenCalled()
    expect(instanceService.setContainerId).not.toHaveBeenCalled()
    expect(settleRuntimeMigratedRuns).not.toHaveBeenCalled()
  })

  it('does not switch if a legacy run cannot be confirmed idle', async () => {
    reader.sessionStatus.mockResolvedValue({ ok: true, data: { busy: { type: 'busy' } } })
    mocks.abort.mockResolvedValue(false)
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'start_failed', detail: 'legacy_archive_failed' })
    expect(mocks.abort).toHaveBeenCalledWith({ client: reader, rootSessionId: 'busy' })
    expect(exportLegacySessions).not.toHaveBeenCalled()
    expect(docker.createContainer).not.toHaveBeenCalled()
  })

  it('does not touch containers when another startup wins the migration claim', async () => {
    vi.mocked(instanceService.claimStartingTransition).mockResolvedValue({ count: 0 })
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'already_running' })
    expect(exportLegacySessions).not.toHaveBeenCalled()
    expect(docker.removeContainer).not.toHaveBeenCalled()
  })

  it('does not stop or allow a second start while an archive startup owns the instance', async () => {
    vi.mocked(instanceService.findBySlug).mockResolvedValue({ ...legacyInstance(), status: 'starting', startedAt: new Date() })
    expect(await stopInstance('alice', 'owner')).toEqual({ ok: false, error: 'stop_failed' })
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'already_running' })
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
      expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'already_running' })
      expect(docker.removeManagedContainerForSlug).not.toHaveBeenCalled()
      return { ok: true, data: { archived: 40 } }
    })
    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
    expect(instanceService.continueStartingTransition).toHaveBeenCalledOnce()
    expect(docker.createContainer).toHaveBeenCalledOnce()
  })

  it('does not tear down a replacement or settle runs after losing migration ownership', async () => {
    vi.mocked(instanceService.continueStartingTransition).mockResolvedValue({ count: 0 })
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'already_running' })
    expect(docker.removeContainer).not.toHaveBeenCalled()
    expect(docker.removeManagedContainerForSlug).not.toHaveBeenCalled()
    expect(docker.createContainer).not.toHaveBeenCalled()
    expect(settleRuntimeMigratedRuns).not.toHaveBeenCalled()
  })

  it('does not mount a legacy volume again when archive container removal failed', async () => {
    vi.mocked(docker.findLegacyArchiveSource).mockResolvedValue(null)
    vi.mocked(docker.removeContainer).mockRejectedValue(new Error('remove failed'))
    expect(await startInstance('alice', 'owner')).toMatchObject({ ok: false, error: 'start_failed' })
    expect(docker.createContainer).not.toHaveBeenCalled()
    expect(settleRuntimeMigratedRuns).not.toHaveBeenCalled()
  })

  it('refuses a restart until the managed archive helper is confirmed removed', async () => {
    vi.mocked(instanceService.findBySlug).mockResolvedValue(legacyInstance('opencode-v2'))
    vi.mocked(docker.removeManagedArchiveContainerForSlug).mockRejectedValue(new Error('helper still running'))
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'start_failed', detail: 'legacy_archive_cleanup_failed' })
    expect(docker.createContainer).not.toHaveBeenCalled()
    expect(docker.removeManagedContainerForSlug).not.toHaveBeenCalled()
    expect(instanceService.failStartingTransition).toHaveBeenCalled()
  })

  it('keeps fresh startup status while history export has no serving container', async () => {
    vi.mocked(instanceService.findStatusBySlug).mockResolvedValue({ ...legacyInstance(), status: 'starting', startedAt: new Date(), containerId: null })
    expect(await getInstanceStatus('alice')).toMatchObject({ status: 'starting', containerId: null })
    expect(docker.isContainerRunning).not.toHaveBeenCalled()
  })

  it('does not re-export when restarting a V2 workspace', async () => {
    vi.mocked(instanceService.findBySlug).mockResolvedValue(legacyInstance('opencode-v2'))
    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
    expect(docker.findLegacyArchiveSource).not.toHaveBeenCalled()
    expect(getLegacySessionReader).not.toHaveBeenCalled()
    expect(exportLegacySessions).not.toHaveBeenCalled()
    expect(settleRuntimeMigratedRuns).not.toHaveBeenCalled()
    expect(docker.createContainer).toHaveBeenCalledWith('alice', 'test-only', '{}', '', [], expect.anything())
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeRuntime } from '@/lib/harness/__tests__/fake-runtime'
import { instanceService } from '@/lib/services'
import { startInstance } from '@/lib/spawner/core'
import { createContainer } from '@/lib/spawner/docker'

const mocks = vi.hoisted(() => ({ runtime: vi.fn(), sync: vi.fn() }))
vi.mock('@/lib/services', () => ({
  instanceService: {
    findBySlug: vi.fn(), upsertStarting: vi.fn(), setContainerId: vi.fn(), setRunningIfCurrentContainer: vi.fn(),
    setErrorIfCurrentContainer: vi.fn().mockResolvedValue({ count: 1 }),
  },
  userService: {},
  providerService: { markWorkspaceRestartRequired: vi.fn(), clearWorkspaceRestartRequired: vi.fn() },
  auditService: { createEvent: vi.fn() },
}))
vi.mock('@/lib/harness/registry', () => ({
  getRuntime: mocks.runtime, CURRENT_RUNTIME_KIND: 'opencode-v2', isCurrentRuntimeKind: (kind: string | null) => kind === 'opencode-v2',
  getRuntimeBaseUrl: vi.fn(() => 'http://runtime'), DEFAULT_HEALTH_TIMEOUT_MS: 5000,
}))
vi.mock('@/lib/spawner/crypto', () => ({ generatePassword: () => 'test', encryptPassword: () => 'encrypted' }))
vi.mock('@/lib/spawner/docker', () => ({
  createContainer: vi.fn().mockResolvedValue({ id: 'v2-container' }), startContainer: vi.fn(),
  removeManagedContainerForSlug: vi.fn().mockResolvedValue(false), removeContainer: vi.fn().mockResolvedValue(undefined), stopContainer: vi.fn().mockResolvedValue(undefined),
  removeManagedArchiveContainerForSlug: vi.fn().mockResolvedValue(undefined),
  isContainerRunning: vi.fn().mockResolvedValue(true), inspectContainer: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/spawner/runtime-artifacts', () => ({
  buildWorkspaceRuntimeArtifacts: vi.fn().mockResolvedValue({ owner: null, opencodeConfigContent: '{}', agentsMd: '', skills: [] }),
  hashWorkspaceRuntimeArtifacts: () => 'hash', getWebProviderGatewayConfig: () => ({}),
}))

describe('V2 startup attempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(instanceService.findBySlug).mockResolvedValue(null)
    mocks.runtime.mockReturnValue({ ...fakeRuntime(), kind: 'opencode-v2', syncProviderAccess: mocks.sync })
    mocks.sync.mockResolvedValue({ ok: true, data: undefined })
    vi.mocked(instanceService.setRunningIfCurrentContainer).mockResolvedValue({ count: 1 })
  })

  it('records the current runtime kind on both container-keyed state writes', async () => {
    expect(await startInstance('alice', 'admin')).toEqual({ ok: true, status: 'running' })
    expect(createContainer).toHaveBeenCalledWith('alice', 'test', '{}', '', [], { name: 'alice', email: undefined })
    expect(instanceService.setContainerId).toHaveBeenCalledWith('alice', 'v2-container', 'opencode-v2')
    expect(instanceService.setRunningIfCurrentContainer).toHaveBeenCalledWith('alice', 'v2-container', 'hash', 'opencode-v2')
  })

  it('never publishes V2 running when provider access could not be verified', async () => {
    mocks.sync.mockResolvedValue({ ok: false, error: { code: 'sync_failed', detail: 'unverified' } })
    expect(await startInstance('alice', 'admin')).toEqual({ ok: false, error: 'start_failed', detail: 'sync_failed' })
    expect(instanceService.setRunningIfCurrentContainer).not.toHaveBeenCalled()
    expect(instanceService.setErrorIfCurrentContainer).toHaveBeenCalledWith('alice', 'v2-container')
  })
})

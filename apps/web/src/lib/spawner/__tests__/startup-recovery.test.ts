import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstanceRecord } from '@/lib/services/instance'
import { startInstance } from '@/lib/spawner/core'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), removeContainer: vi.fn(), authHeaders: [] as string[] }))

vi.mock('@/lib/prisma', () => ({ prisma: { instance: mocks } }))
vi.mock('@/lib/services', async () => ({
  instanceService: await import('@/lib/services/instance'),
  auditService: { createEvent: vi.fn() }, providerService: { clearWorkspaceRestartRequired: vi.fn() }, userService: {},
}))
vi.mock('@/lib/harness/execution', () => ({}))
vi.mock('@/lib/harness/legacy-session-archive', () => ({ exportLegacySessions: async () => ({ ok: true, data: { archived: 1 } }) }))
vi.mock('@/lib/services/runtime-migration', () => ({ settleRuntimeMigratedRuns: async () => {} }))
vi.mock('@/lib/spawner/legacy-archive', () => ({ withHistoryMigrationProgress: (_slug: string, work: () => Promise<unknown>) => work() }))
vi.mock('@/lib/spawner/crypto', () => ({ generatePassword: () => 'next', encryptPassword: (value: string) => `enc:${value}`, decryptPassword: (value: string) => value.slice(4) }))
vi.mock('@/lib/spawner/runtime-artifacts', () => ({
  buildWorkspaceRuntimeArtifacts: async () => ({ owner: null, opencodeConfigContent: '{}', skills: [] }),
  hashWorkspaceRuntimeArtifacts: () => 'hash', getWebProviderGatewayConfig: () => ({}),
}))
vi.mock('@/lib/harness/registry', () => ({
  CURRENT_RUNTIME_KIND: 'opencode-v2', DEFAULT_HEALTH_TIMEOUT_MS: 5_000,
  isCurrentRuntimeKind: (kind: string | null) => kind === 'opencode-v2',
  getRuntime: () => ({ health: async () => ({ ok: true, data: {} }), syncProviderAccess: async () => ({ ok: true, data: undefined }) }),
  getRuntimeBaseUrl: () => 'http://opencode-alice:4096',
  getLegacySessionReader: (_slug: string, connection: { authHeader: string }) => {
    mocks.authHeaders.push(connection.authHeader)
    return { sessionStatus: async () => connection.authHeader === `Basic ${Buffer.from('opencode:previous').toString('base64')}`
      ? { ok: true, data: {} } : { ok: false, error: { code: 'http_status_401' } } }
  },
}))
vi.mock('@/lib/spawner/docker', () => ({
  hasLegacyBackendWriters: async () => false,
  removeOrphanedV2ContainerForSlug: async () => {}, removeManagedArchiveContainerForSlug: async () => {},
  findLegacyArchiveSource: async () => ({ id: 'legacy', name: 'opencode-alice', running: true }),
  removeContainer: mocks.removeContainer, removeManagedContainerForSlug: async () => {},
  createContainer: async () => ({ id: 'next' }), startContainer: async () => {},
  isContainerRunning: async () => true, inspectContainer: async () => ({}),
}))

let current: InstanceRecord

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authHeaders.length = 0
  current = {
    id: 'instance', slug: 'alice', status: 'running', containerId: 'legacy', runtimeKind: 'opencode-v1',
    createdAt: new Date(0), startedAt: new Date(1), stoppedAt: null, lastActivityAt: new Date(2),
    serverPassword: 'enc:previous', appliedConfigSha: null, providerSyncHash: null, providerSyncedAt: null,
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
})

describe('legacy migration recovery', () => {
  it('retries a failed teardown using the original live source credentials before rotating them', async () => {
    expect(await startInstance('alice', 'owner')).toEqual({ ok: false, error: 'start_failed', detail: 'legacy_archive_cleanup_failed' })
    expect(current).toMatchObject({ status: 'error', runtimeKind: 'opencode-v1', serverPassword: 'enc:previous' })

    expect(await startInstance('alice', 'owner')).toEqual({ ok: true, status: 'running' })
    expect(current).toMatchObject({ status: 'running', runtimeKind: 'opencode-v2', serverPassword: 'enc:next', containerId: 'next' })
    expect(mocks.authHeaders).toEqual(Array(2).fill(`Basic ${Buffer.from('opencode:previous').toString('base64')}`))
  })
})

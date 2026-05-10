import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadConfigRepoSnapshot = vi.fn()
let snapshotRepoDir: string | null = null

async function writeSnapshotRepoFile(relativePath: string, content: string): Promise<void> {
  if (!snapshotRepoDir) {
    throw new Error('snapshot_repo_not_configured')
  }

  const filePath = path.join(snapshotRepoDir, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

// Mock services (used directly by core.ts and transitively by runtime-config-hash.ts, mcp-config.ts)
vi.mock('@/lib/services', () => ({
  instanceService: {
    findBySlug: vi.fn(),
    upsertStarting: vi.fn(),
    setContainerId: vi.fn(),
    setError: vi.fn(),
    setRunning: vi.fn(),
    setStopped: vi.fn(),
    setStoppedNoContainer: vi.fn(),
    correctToRunning: vi.fn(),
    findStatusBySlug: vi.fn(),
    findActiveInstances: vi.fn(),
  },
  userService: {
    findIdentityBySlug: vi.fn(),
    findIdBySlug: vi.fn(),
  },
  connectorService: {
    findHashEntriesByUserId: vi.fn().mockResolvedValue([]),
    findEnabledMcpByUserId: vi.fn().mockResolvedValue([]),
  },
  providerService: {
    markWorkspaceRestartRequired: vi.fn().mockResolvedValue({ count: 0 }),
    clearWorkspaceRestartRequired: vi.fn().mockResolvedValue({ count: 0 }),
  },
  auditService: {
    createEvent: vi.fn(),
  },
}))

// Mock opencode client
vi.mock('@/lib/opencode/client', () => ({
  getInstanceUrl: vi.fn((slug: string) => `http://opencode-${slug}:4096`),
  isInstanceHealthyWithPassword: vi.fn(),
}))

// Mock opencode providers
vi.mock('@/lib/opencode/providers', () => ({
  syncProviderAccessForInstance: vi.fn().mockResolvedValue({ ok: true }),
}))

// Mock workspace config store
vi.mock('@/lib/common-workspace-config-store', () => ({
  getCommonWorkspaceConfigHash: vi.fn().mockResolvedValue({
    ok: true,
    hash: 'hash',
  }),
  readCommonWorkspaceConfig: vi.fn().mockResolvedValue({
    ok: true,
    content: JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'assistant',
      agent: {},
    }),
    hash: 'hash',
    path: '/kb-config/CommonWorkspaceConfig.json',
  }),
  readConfigRepoFile: vi.fn().mockResolvedValue({
    ok: true,
    content: '# AGENTS.md',
  }),
}))

vi.mock('@/lib/config-repo-store', () => ({
  readConfigRepoSnapshot: (
    reader: (context: { repoDir: string; hash: string | null }) => Promise<unknown>
  ) => mockReadConfigRepoSnapshot(reader),
}))

vi.mock('@/lib/skills/skill-store', () => ({
  readSkillBundlesFromRepoDir: vi.fn().mockResolvedValue([]),
}))

// Mock docker
vi.mock('../docker', () => ({
  createContainer: vi.fn(),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
  removeManagedContainerForSlug: vi.fn().mockResolvedValue(false),
  inspectContainer: vi.fn(),
  isContainerRunning: vi.fn(),
}))

// Mock MCP config
vi.mock('../mcp-config', () => ({
  buildMcpConfigForSlug: vi.fn(),
}))

// Mock crypto
vi.mock('../crypto', () => ({
  generatePassword: vi.fn(() => 'test-password-123'),
  encryptPassword: vi.fn(() => 'iv:tag:encrypted'),
  decryptPassword: vi.fn(() => 'test-password-123'),
}))

import { isInstanceHealthyWithPassword } from '@/lib/opencode/client'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { auditService, instanceService, providerService, userService } from '@/lib/services'
import { startInstance, stopInstance, getInstanceStatus, isSlowStart, listActiveInstances } from '../core'
import * as crypto from '../crypto'
import * as docker from '../docker'
import { buildMcpConfigForSlug } from '../mcp-config'

const mockInstance = vi.mocked(instanceService)
const mockUser = vi.mocked(userService)
const mockProvider = vi.mocked(providerService)
const mockAudit = vi.mocked(auditService)
const mockCrypto = vi.mocked(crypto)
const mockDocker = vi.mocked(docker)
const mockBuildMcpConfigForSlug = vi.mocked(buildMcpConfigForSlug)
const mockHealth = vi.mocked(isInstanceHealthyWithPassword)
const mockSync = vi.mocked(syncProviderAccessForInstance)

beforeEach(async () => {
  vi.clearAllMocks()
  if (snapshotRepoDir) {
    await fs.rm(snapshotRepoDir, { recursive: true, force: true })
  }

  snapshotRepoDir = await fs.mkdtemp(path.join(tmpdir(), 'core-runtime-repo-'))
  await Promise.all([
    writeSnapshotRepoFile(
      'CommonWorkspaceConfig.json',
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        default_agent: 'assistant',
        agent: {},
      })
    ),
    writeSnapshotRepoFile('AGENTS.md', '# AGENTS.md'),
  ])

  mockReadConfigRepoSnapshot.mockImplementation(
    async (
      reader: (context: { repoDir: string; hash: string | null }) => Promise<unknown>
    ) => ({
      ok: true,
      hash: 'snapshot-hash',
      data: await reader({ repoDir: snapshotRepoDir!, hash: 'snapshot-hash' }),
    })
  )
  mockDocker.inspectContainer.mockResolvedValue({
    NetworkSettings: {
      Networks: {
        'arche-internal': { IPAddress: '10.88.0.12' },
      },
    },
  })
  mockHealth.mockResolvedValue({ ok: true })
  mockSync.mockResolvedValue({ ok: true })
  mockBuildMcpConfigForSlug.mockResolvedValue(null)
})

afterEach(async () => {
  if (snapshotRepoDir) {
    await fs.rm(snapshotRepoDir, { recursive: true, force: true })
    snapshotRepoDir = null
  }
})

describe('startInstance', () => {
  it('returns already_running if instance is running', async () => {
    mockInstance.findBySlug.mockResolvedValue({
      id: '1', slug: 'alice', status: 'running',
      containerId: 'abc', serverPassword: 'enc',
      createdAt: new Date(), startedAt: new Date(),
      stoppedAt: null, lastActivityAt: new Date(),
      appliedConfigSha: null,
    })

    const result = await startInstance('alice', 'user-1')

    expect(result).toEqual({ ok: false, error: 'already_running' })
    expect(mockDocker.createContainer).not.toHaveBeenCalled()
  })

  it('returns already_running if instance is already starting', async () => {
    mockInstance.findBySlug.mockResolvedValue({
      id: '1', slug: 'alice', status: 'starting',
      containerId: 'abc', serverPassword: 'enc',
      createdAt: new Date(), startedAt: new Date(),
      stoppedAt: null, lastActivityAt: null,
      appliedConfigSha: null,
    })

    const result = await startInstance('alice', 'user-1')

    expect(result).toEqual({ ok: false, error: 'already_running' })
    expect(mockInstance.upsertStarting).not.toHaveBeenCalled()
    expect(mockDocker.createContainer).not.toHaveBeenCalled()
  })

  it('recovers a stale starting instance by recreating its container', async () => {
    vi.stubEnv('ARCHE_START_TIMEOUT_MS', '1000')

    try {
      mockInstance.findBySlug.mockResolvedValue({
        id: '1', slug: 'alice', status: 'starting',
        containerId: 'stale-container', serverPassword: 'enc',
        createdAt: new Date(), startedAt: new Date(Date.now() - 2_001),
        stoppedAt: null, lastActivityAt: null,
        appliedConfigSha: null,
      })
      mockInstance.upsertStarting.mockResolvedValue({} as never)
      mockInstance.setContainerId.mockResolvedValue({} as never)
      mockInstance.setRunning.mockResolvedValue({} as never)
      mockUser.findIdentityBySlug.mockResolvedValue(null)
      mockDocker.removeContainer.mockResolvedValue(undefined)
      mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
      mockDocker.startContainer.mockResolvedValue(undefined)
      mockDocker.isContainerRunning.mockResolvedValue(true)
      mockHealth.mockResolvedValue({ ok: true })

      const result = await startInstance('alice', 'user-1')

      expect(result).toEqual({ ok: true, status: 'running' })
      expect(mockDocker.removeContainer).toHaveBeenCalledWith('stale-container')
      expect(mockDocker.createContainer).toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('creates container and starts it when no existing instance', async () => {
    mockBuildMcpConfigForSlug.mockResolvedValue({
      $schema: 'https://opencode.ai/config.json',
      mcp: {},
    })
    mockInstance.findBySlug.mockResolvedValue(null)
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setContainerId.mockResolvedValue({} as never)
    mockInstance.setRunning.mockResolvedValue({} as never)
    mockUser.findIdentityBySlug.mockResolvedValue({ id: 'owner-1', slug: 'alice', email: 'alice@example.com' })
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(true)

    const result = await startInstance('alice', 'user-1')

    expect(result).toEqual({ ok: true, status: 'running' })
    const [slug, password, configContent, agentsMd, skills, gitAuthor] = mockDocker.createContainer.mock.calls[0] ?? []
    expect(slug).toBe('alice')
    expect(password).toBe('test-password-123')
    expect(typeof configContent).toBe('string')
    expect(configContent).toContain('"$schema":"https://opencode.ai/config.json"')
    expect(typeof agentsMd).toBe('string')
    expect(skills).toEqual([])
    expect(gitAuthor).toEqual({ name: 'alice', email: 'alice@example.com' })
    expect(mockDocker.startContainer).toHaveBeenCalledWith('container-123')
    expect(mockSync).toHaveBeenCalledWith({
      instance: { baseUrl: expect.any(String), authHeader: expect.any(String) },
      slug: 'alice',
      userId: 'owner-1',
    })
    expect(mockAudit.createEvent).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'instance.started',
      metadata: { slug: 'alice' },
    })
  })

  it('removes stale tracked container before starting again', async () => {
    mockInstance.findBySlug.mockResolvedValue({
      id: '1', slug: 'alice', status: 'error',
      containerId: 'stale-container', serverPassword: 'enc',
      createdAt: new Date(), startedAt: new Date(),
      stoppedAt: null, lastActivityAt: null,
      appliedConfigSha: null,
    })
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setContainerId.mockResolvedValue({} as never)
    mockInstance.setRunning.mockResolvedValue({} as never)
    mockDocker.removeContainer.mockResolvedValue(undefined)
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(true)

    const result = await startInstance('alice', 'user-1')

    expect(result).toEqual({ ok: true, status: 'running' })
    expect(mockDocker.removeContainer).toHaveBeenCalledWith('stale-container')
    expect(mockDocker.removeManagedContainerForSlug).toHaveBeenCalledWith('alice')
  })

  it('checks for stale managed container names before creating a container', async () => {
    mockInstance.findBySlug.mockResolvedValue(null)
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setContainerId.mockResolvedValue({} as never)
    mockInstance.setRunning.mockResolvedValue({} as never)
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(true)

    await startInstance('alice', 'user-1')

    expect(mockDocker.removeManagedContainerForSlug).toHaveBeenCalledWith('alice')
    expect(mockDocker.removeManagedContainerForSlug.mock.invocationCallOrder[0]).toBeLessThan(
      mockDocker.createContainer.mock.invocationCallOrder[0]
    )
  })

  it('continues startup when stale tracked container cleanup fails', async () => {
    mockInstance.findBySlug.mockResolvedValue({
      id: '1', slug: 'alice', status: 'error',
      containerId: 'missing-container', serverPassword: 'enc',
      createdAt: new Date(), startedAt: new Date(),
      stoppedAt: null, lastActivityAt: null,
      appliedConfigSha: null,
    })
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setContainerId.mockResolvedValue({} as never)
    mockInstance.setRunning.mockResolvedValue({} as never)
    mockDocker.removeContainer.mockRejectedValueOnce(new Error('not found'))
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(true)

    const result = await startInstance('alice', 'user-1')

    expect(result).toEqual({ ok: true, status: 'running' })
    expect(mockDocker.createContainer).toHaveBeenCalled()
  })

  it('syncs providers before marking instance as running', async () => {
    mockInstance.findBySlug.mockResolvedValue(null)
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setContainerId.mockResolvedValue({} as never)
    mockInstance.setRunning.mockResolvedValue({} as never)
    mockUser.findIdentityBySlug.mockResolvedValue({ id: 'owner-1', slug: 'alice', email: 'alice@example.com' })
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(true)

    let syncCalledBeforeRunning = false
    mockSync.mockImplementation(async () => {
      syncCalledBeforeRunning = !mockInstance.setRunning.mock.calls.length
      return { ok: true }
    })

    await startInstance('alice', 'user-1')

    expect(syncCalledBeforeRunning).toBe(true)
    expect(mockSync).toHaveBeenCalled()
  })

  it('does not suppress dispose when syncing providers', async () => {
    mockInstance.findBySlug.mockResolvedValue(null)
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setContainerId.mockResolvedValue({} as never)
    mockInstance.setRunning.mockResolvedValue({} as never)
    mockUser.findIdentityBySlug.mockResolvedValue({ id: 'owner-1', slug: 'alice', email: 'alice@example.com' })
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(true)

    await startInstance('alice', 'user-1')

    const syncCall = mockSync.mock.calls[0]?.[0] as { disposeInstance?: boolean } | undefined
    expect(syncCall).not.toHaveProperty('disposeInstance', false)
  })

  it('continues startup through direct container IP when DNS healthcheck stays unavailable', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      mockInstance.findBySlug.mockResolvedValue(null)
      mockInstance.upsertStarting.mockResolvedValue({} as never)
      mockInstance.setContainerId.mockResolvedValue({} as never)
      mockInstance.setRunning.mockResolvedValue({} as never)
      mockUser.findIdentityBySlug.mockResolvedValue(null)
      mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
      mockDocker.startContainer.mockResolvedValue(undefined)
      mockDocker.isContainerRunning.mockResolvedValue(true)
      mockHealth.mockImplementation(async (_slug, _password, baseUrl) => {
        if (baseUrl === 'http://10.88.0.12:4096') {
          return { ok: true }
        }

        return { ok: false, detail: 'dns_resolution_error' }
      })

      await expect(startInstance('alice', 'user-1')).resolves.toEqual({ ok: true, status: 'running' })
      expect(mockSync).toHaveBeenCalledWith({
        instance: { baseUrl: 'http://10.88.0.12:4096', authHeader: expect.any(String) },
        slug: 'alice',
        userId: 'user-1',
      })
      expect(warnSpy).toHaveBeenCalledWith(
        '[spawner] DNS healthcheck unavailable after direct IP success; continuing startup',
        expect.objectContaining({ detail: 'dns_resolution_error', directBaseUrl: 'http://10.88.0.12:4096' }),
      )
    } finally {
      logSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('marks the workspace for restart when provider sync fails', async () => {
    mockInstance.findBySlug.mockResolvedValue(null)
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setContainerId.mockResolvedValue({} as never)
    mockInstance.setRunning.mockResolvedValue({} as never)
    mockUser.findIdentityBySlug.mockResolvedValue({ id: 'owner-1', slug: 'alice', email: 'alice@example.com' })
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(true)
    mockSync.mockResolvedValue({ ok: false, error: 'sync_failed' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(startInstance('alice', 'user-1')).resolves.toEqual({ ok: true, status: 'running' })

    expect(mockProvider.markWorkspaceRestartRequired).toHaveBeenCalledWith('owner-1')
    expect(mockProvider.clearWorkspaceRestartRequired).not.toHaveBeenCalled()
  })

  it('returns timeout when container never becomes healthy', async () => {
    mockInstance.findBySlug.mockResolvedValue(null)
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setContainerId.mockResolvedValue({} as never)
    mockInstance.setError.mockResolvedValue({} as never)
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(false)
    mockHealth.mockResolvedValue({ ok: false, detail: 'connection_refused', message: 'ECONNREFUSED' })
    mockDocker.stopContainer.mockResolvedValue(undefined)
    mockDocker.removeContainer.mockResolvedValue(undefined)

    // Override timeout to be very short for test
    vi.stubEnv('ARCHE_START_TIMEOUT_MS', '100')

    const result = await startInstance('alice', 'user-1')

    expect(result).toMatchObject({ ok: false, error: 'timeout' })
    vi.unstubAllEnvs()
  })

  it('returns start_failed on docker error', async () => {
    mockInstance.findBySlug.mockResolvedValue(null)
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setError.mockResolvedValue({} as never)
    mockDocker.createContainer.mockRejectedValue(new Error('Docker unavailable'))

    const result = await startInstance('alice', 'user-1')

    expect(result).toMatchObject({ ok: false, error: 'start_failed' })
  })

  it('cleans up a created container when startup fails without a detail message', async () => {
    mockInstance.findBySlug.mockResolvedValue(null)
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setContainerId.mockResolvedValue({} as never)
    mockInstance.setError.mockResolvedValue({} as never)
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockRejectedValue({})
    mockDocker.stopContainer.mockResolvedValue(undefined)
    mockDocker.removeContainer.mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await startInstance('alice', 'user-1')

    expect(result).toEqual({ ok: false, error: 'start_failed', detail: undefined })
    expect(mockDocker.stopContainer).toHaveBeenCalledWith('container-123')
    expect(mockDocker.removeContainer).toHaveBeenCalledWith('container-123')
  })
})

describe('stopInstance', () => {
  it('returns not_running if instance does not exist', async () => {
    mockInstance.findBySlug.mockResolvedValue(null)

    const result = await stopInstance('alice', 'user-1')

    expect(result).toEqual({ ok: false, error: 'not_running' })
  })

  it('returns not_running if instance already stopped', async () => {
    mockInstance.findBySlug.mockResolvedValue({
      id: '1', slug: 'alice', status: 'stopped',
      containerId: null, serverPassword: 'enc',
      createdAt: new Date(), startedAt: null,
      stoppedAt: new Date(), lastActivityAt: null,
      appliedConfigSha: null,
    })

    const result = await stopInstance('alice', 'user-1')

    expect(result).toEqual({ ok: false, error: 'not_running' })
  })

  it('stops and removes container when running', async () => {
    mockInstance.findBySlug.mockResolvedValue({
      id: '1', slug: 'alice', status: 'running',
      containerId: 'abc-123', serverPassword: 'enc',
      createdAt: new Date(), startedAt: new Date(),
      stoppedAt: null, lastActivityAt: new Date(),
      appliedConfigSha: null,
    })
    mockDocker.stopContainer.mockResolvedValue(undefined)
    mockDocker.removeContainer.mockResolvedValue(undefined)
    mockInstance.setStopped.mockResolvedValue({} as never)

    const result = await stopInstance('alice', 'user-1')

    expect(result).toEqual({ ok: true, status: 'stopped' })
    expect(mockDocker.stopContainer).toHaveBeenCalledWith('abc-123')
    expect(mockDocker.removeContainer).toHaveBeenCalledWith('abc-123')
    expect(mockAudit.createEvent).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'instance.stopped',
      metadata: { slug: 'alice' },
    })
  })

  it('returns stop_failed when persisting stopped state fails', async () => {
    mockInstance.findBySlug.mockResolvedValue({
      id: '1', slug: 'alice', status: 'running',
      containerId: null, serverPassword: 'enc',
      createdAt: new Date(), startedAt: new Date(),
      stoppedAt: null, lastActivityAt: new Date(),
      appliedConfigSha: null,
    })
    mockInstance.setStopped.mockRejectedValue(new Error('db down'))

    await expect(stopInstance('alice', 'user-1')).resolves.toEqual({ ok: false, error: 'stop_failed' })
  })
})

describe('getInstanceStatus', () => {
  it('returns instance status fields', async () => {
    const now = new Date()
    mockInstance.findStatusBySlug.mockResolvedValue({
      status: 'running', startedAt: now, stoppedAt: null, lastActivityAt: now, containerId: 'abc',
      serverPassword: 'enc',
    })
    mockDocker.isContainerRunning.mockResolvedValue(true)
    mockHealth.mockResolvedValue({ ok: true })

    const result = await getInstanceStatus('alice')

    expect(result).toEqual({
      status: 'running', startedAt: now, stoppedAt: null, lastActivityAt: now, containerId: 'abc',
      serverPassword: 'enc',
    })
  })

  it('returns null for non-existent instance', async () => {
    mockInstance.findStatusBySlug.mockResolvedValue(null)

    const result = await getInstanceStatus('unknown')

    expect(result).toBeNull()
  })

  it('marks running instances without a container as stopped', async () => {
    const now = new Date()
    mockInstance.findStatusBySlug.mockResolvedValue({
      status: 'running', startedAt: now, stoppedAt: null, lastActivityAt: now, containerId: null,
      serverPassword: 'enc',
    })
    mockInstance.setStoppedNoContainer.mockResolvedValue({} as never)

    await expect(getInstanceStatus('alice')).resolves.toEqual({
      status: 'stopped', startedAt: now, stoppedAt: null, lastActivityAt: now, containerId: null,
      serverPassword: 'enc',
    })
    expect(mockInstance.setStoppedNoContainer).toHaveBeenCalledWith('alice')
  })

  it('marks missing containers as stopped', async () => {
    const now = new Date()
    mockInstance.findStatusBySlug.mockResolvedValue({
      status: 'running', startedAt: now, stoppedAt: null, lastActivityAt: now, containerId: 'missing',
      serverPassword: 'enc',
    })
    mockDocker.isContainerRunning.mockResolvedValue(false)
    mockDocker.removeContainer.mockResolvedValue(undefined)
    mockInstance.setStopped.mockResolvedValue({} as never)

    await expect(getInstanceStatus('alice')).resolves.toMatchObject({ status: 'stopped', containerId: null })
    expect(mockDocker.removeContainer).toHaveBeenCalledWith('missing')
    expect(mockInstance.setStopped).toHaveBeenCalledWith('alice')
  })

  it('corrects healthy starting instances to running', async () => {
    const now = new Date()
    mockInstance.findStatusBySlug.mockResolvedValue({
      status: 'starting', startedAt: now, stoppedAt: null, lastActivityAt: now, containerId: 'abc',
      serverPassword: 'enc',
    })
    mockDocker.isContainerRunning.mockResolvedValue(true)
    mockHealth.mockResolvedValue({ ok: true })
    mockInstance.correctToRunning.mockResolvedValue({} as never)

    await expect(getInstanceStatus('alice')).resolves.toMatchObject({ status: 'running', containerId: 'abc' })
    expect(mockInstance.correctToRunning).toHaveBeenCalledWith('alice')
  })

  it('keeps running containers in starting state until OpenCode responds', async () => {
    const now = new Date()
    mockInstance.findStatusBySlug.mockResolvedValue({
      status: 'running', startedAt: now, stoppedAt: null, lastActivityAt: now, containerId: 'abc',
      serverPassword: 'enc',
    })
    mockDocker.isContainerRunning.mockResolvedValue(true)
    mockHealth.mockResolvedValue({ ok: false, detail: 'connection_refused' })

    await expect(getInstanceStatus('alice')).resolves.toMatchObject({ status: 'starting', containerId: 'abc' })
  })

  it('returns the stored status when password decryption fails', async () => {
    const now = new Date()
    const instance = {
      status: 'starting' as const, startedAt: now, stoppedAt: null, lastActivityAt: now, containerId: 'abc',
      serverPassword: 'bad',
    }
    mockInstance.findStatusBySlug.mockResolvedValue(instance)
    mockDocker.isContainerRunning.mockResolvedValue(true)
    mockCrypto.decryptPassword.mockImplementationOnce(() => { throw new Error('bad password') })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(getInstanceStatus('alice')).resolves.toBe(instance)
  })
})

describe('listActiveInstances', () => {
  it('delegates to the instance service', async () => {
    mockInstance.findActiveInstances.mockResolvedValue([{ slug: 'alice' }] as never)

    await expect(listActiveInstances()).resolves.toEqual([{ slug: 'alice' }])
    expect(mockInstance.findActiveInstances).toHaveBeenCalledTimes(1)
  })
})

describe('isSlowStart', () => {
  it('returns false if instance is not starting', () => {
    expect(isSlowStart({ status: 'running', startedAt: new Date() })).toBe(false)
  })

  it('returns false if no startedAt', () => {
    expect(isSlowStart({ status: 'starting', startedAt: null })).toBe(false)
  })

  it('returns false if null', () => {
    expect(isSlowStart(null)).toBe(false)
  })

  it('returns true if starting and elapsed > expected', () => {
    const old = new Date(Date.now() - 20_000) // 20s ago
    expect(isSlowStart({ status: 'starting', startedAt: old })).toBe(true)
  })

  it('returns false if starting but within expected time', () => {
    const recent = new Date(Date.now() - 1_000) // 1s ago
    expect(isSlowStart({ status: 'starting', startedAt: recent })).toBe(false)
  })
})

describe('startInstance - agent config transforms', () => {
  it('remaps connector IDs and injects self-delegation guards', async () => {
    await writeSnapshotRepoFile(
      'CommonWorkspaceConfig.json',
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        default_agent: 'assistant',
        agent: {
          assistant: {
            mode: 'primary',
            prompt: 'You are helpful.',
            tools: { task: true, bash: true },
          },
          linear: {
            mode: 'subagent',
            prompt: 'Handle Linear tasks.',
            tools: { task: true, 'arche_*': false, 'arche_linear_admin111_*': true },
          },
        },
      })
    )

    mockBuildMcpConfigForSlug.mockResolvedValue({
      mcpConfig: {
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          arche_linear_user999: {
            type: 'remote',
            url: 'https://mcp.linear.app/mcp',
            enabled: true,
            headers: { Authorization: 'Bearer tok' },
            oauth: false,
          },
        },
      },
      connectorToolPermissions: {},
    })

    mockInstance.findBySlug.mockResolvedValue(null)
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setContainerId.mockResolvedValue({} as never)
    mockInstance.setRunning.mockResolvedValue({} as never)
    mockUser.findIdentityBySlug.mockResolvedValue({ id: 'owner-1', slug: 'bob', email: 'bob@example.com' })
    mockDocker.createContainer.mockResolvedValue({ id: 'container-456' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(true)

    await startInstance('bob', 'user-2')

    const configContent = mockDocker.createContainer.mock.calls[0]?.[2] as string
    expect(configContent).toBeDefined()

    const parsed = JSON.parse(configContent)

    const linearTools = parsed.agent.linear.tools
    expect(linearTools['arche_linear_user999_*']).toBe(true)
    expect(linearTools['arche_linear_admin111_*']).toBeUndefined()
    expect(linearTools['arche_*']).toBe(false)
    expect(linearTools.email_draft).toBe(true)

    const assistantTools = parsed.agent.assistant.tools
    expect(assistantTools.email_draft).toBe(true)

    const linearPrompt = parsed.agent.linear.prompt as string
    expect(linearPrompt).toContain('## Delegation constraint')
    expect(linearPrompt).toContain('MUST NEVER use the task tool to invoke yourself ("linear")')

    const assistantPrompt = parsed.agent.assistant.prompt as string
    expect(assistantPrompt).not.toContain('Delegation constraint')
  })
})

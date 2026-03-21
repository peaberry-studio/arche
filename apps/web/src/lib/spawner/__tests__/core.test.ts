import { describe, it, expect, vi, beforeEach } from 'vitest'

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

// Mock docker
vi.mock('../docker', () => ({
  createContainer: vi.fn(),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  removeContainer: vi.fn(),
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

import { readCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import { isInstanceHealthyWithPassword } from '@/lib/opencode/client'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { auditService, instanceService, userService } from '@/lib/services'
import { startInstance, stopInstance, getInstanceStatus, isSlowStart } from '../core'
import * as docker from '../docker'
import { buildMcpConfigForSlug } from '../mcp-config'

const mockInstance = vi.mocked(instanceService)
const mockUser = vi.mocked(userService)
const mockAudit = vi.mocked(auditService)
const mockDocker = vi.mocked(docker)
const mockBuildMcpConfigForSlug = vi.mocked(buildMcpConfigForSlug)
const mockHealth = vi.mocked(isInstanceHealthyWithPassword)
const mockSync = vi.mocked(syncProviderAccessForInstance)
const mockReadCommonWorkspaceConfig = vi.mocked(readCommonWorkspaceConfig)

beforeEach(() => {
  vi.clearAllMocks()
  mockHealth.mockResolvedValue(true)
  mockBuildMcpConfigForSlug.mockResolvedValue(null)
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
    const [slug, password, configContent, agentsMd, gitAuthor] = mockDocker.createContainer.mock.calls[0] ?? []
    expect(slug).toBe('alice')
    expect(password).toBe('test-password-123')
    expect(typeof configContent).toBe('string')
    expect(configContent).toContain('"$schema":"https://opencode.ai/config.json"')
    expect(typeof agentsMd).toBe('string')
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

  it('returns timeout when container never becomes healthy', async () => {
    mockInstance.findBySlug.mockResolvedValue(null)
    mockInstance.upsertStarting.mockResolvedValue({} as never)
    mockInstance.setContainerId.mockResolvedValue({} as never)
    mockInstance.setError.mockResolvedValue({} as never)
    mockDocker.createContainer.mockResolvedValue({ id: 'container-123' } as never)
    mockDocker.startContainer.mockResolvedValue(undefined)
    mockDocker.isContainerRunning.mockResolvedValue(false)
    mockHealth.mockResolvedValue(false)
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
})

describe('getInstanceStatus', () => {
  it('returns instance status fields', async () => {
    const now = new Date()
    mockInstance.findStatusBySlug.mockResolvedValue({
      status: 'running', startedAt: now, stoppedAt: null, lastActivityAt: now, containerId: 'abc',
      serverPassword: 'enc',
    })
    mockDocker.isContainerRunning.mockResolvedValue(true)
    mockHealth.mockResolvedValue(true)

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
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
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
      }),
      hash: 'hash',
      path: '/kb-config/CommonWorkspaceConfig.json',
    } as never)

    mockBuildMcpConfigForSlug.mockResolvedValue({
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

    const linearPrompt = parsed.agent.linear.prompt as string
    expect(linearPrompt).toContain('## Delegation constraint')
    expect(linearPrompt).toContain('MUST NEVER use the task tool to invoke yourself ("linear")')

    const assistantPrompt = parsed.agent.assistant.prompt as string
    expect(assistantPrompt).not.toContain('Delegation constraint')
  })
})

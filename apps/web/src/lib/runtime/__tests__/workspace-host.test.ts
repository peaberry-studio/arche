import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/spawner/core', () => ({
  startInstance: vi.fn().mockResolvedValue({ ok: true, status: 'started' }),
  stopInstance: vi.fn().mockResolvedValue({ ok: true, status: 'stopped' }),
  getInstanceStatus: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/opencode/client', () => ({
  getInstanceBasicAuth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/workspace-agent/client', () => ({
  createWorkspaceAgentClient: vi.fn().mockResolvedValue(null),
}))

const mockFindStatusBySlug = vi.fn()
vi.mock('@/lib/services', () => ({
  instanceService: {
    findStatusBySlug: (...args: unknown[]) => mockFindStatusBySlug(...args),
  },
}))

describe('workspace-host dispatcher', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    mockFindStatusBySlug.mockResolvedValue(null)
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('web mode', () => {
    beforeEach(() => {
      delete process.env.ARCHE_RUNTIME_MODE
    })

    it('delegates startWorkspace to spawner core startInstance', async () => {
      const { startWorkspace } = await import('../workspace-host')
      const { startInstance } = await import('@/lib/spawner/core')

      await startWorkspace('alice', 'user-1')
      expect(startInstance).toHaveBeenCalledWith('alice', 'user-1')
    })

    it('delegates stopWorkspace to spawner core stopInstance', async () => {
      const { stopWorkspace } = await import('../workspace-host')
      const { stopInstance } = await import('@/lib/spawner/core')

      await stopWorkspace('alice', 'user-1')
      expect(stopInstance).toHaveBeenCalledWith('alice', 'user-1')
    })

    it('delegates getWorkspaceStatus to getInstanceStatus', async () => {
      const { getInstanceStatus } = await import('@/lib/spawner/core')
      const mockStatus = {
        status: 'running' as const,
        startedAt: new Date(),
        stoppedAt: null,
        lastActivityAt: new Date(),
        containerId: 'c1',
        serverPassword: 'pwd',
      }
      vi.mocked(getInstanceStatus).mockResolvedValue(mockStatus)

      const { getWorkspaceStatus } = await import('../workspace-host')
      const result = await getWorkspaceStatus('alice')

      expect(result).toEqual({
        status: 'running',
        startedAt: mockStatus.startedAt,
        stoppedAt: null,
        lastActivityAt: mockStatus.lastActivityAt,
      })
    })

    it('returns null status when no instance found', async () => {
      const { getInstanceStatus } = await import('@/lib/spawner/core')
      vi.mocked(getInstanceStatus).mockResolvedValue(null)

      const { getWorkspaceStatus } = await import('../workspace-host')
      expect(await getWorkspaceStatus('unknown')).toBeNull()
    })

    it('delegates getWorkspaceConnection to getInstanceBasicAuth', async () => {
      const { getInstanceBasicAuth } = await import('@/lib/opencode/client')
      vi.mocked(getInstanceBasicAuth).mockResolvedValue({
        baseUrl: 'http://opencode-alice:4096',
        authHeader: 'Basic abc',
      })

      const { getWorkspaceConnection } = await import('../workspace-host')
      const conn = await getWorkspaceConnection('alice')
      expect(conn).toEqual({ baseUrl: 'http://opencode-alice:4096', authHeader: 'Basic abc' })
    })
  })

  describe('desktop mode', () => {
    beforeEach(() => {
      process.env.ARCHE_RUNTIME_MODE = 'desktop'
      process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
      process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    })

    it('returns stopped status for unknown slug', async () => {
      const { getWorkspaceStatus } = await import('../workspace-host')
      const result = await getWorkspaceStatus('local')

      expect(result).toEqual({
        status: 'stopped',
        startedAt: null,
        stoppedAt: null,
        lastActivityAt: null,
      })
    })

    it('returns null connection for stopped workspace', async () => {
      const { getWorkspaceConnection, getWorkspaceAgentConnection } =
        await import('../workspace-host')

      expect(await getWorkspaceConnection('local')).toBeNull()
      expect(await getWorkspaceAgentConnection('local')).toBeNull()
    })

    it('stop on non-existent workspace returns already_stopped', async () => {
      const { stopWorkspace } = await import('../workspace-host')
      const result = await stopWorkspace('local', 'user-1')
      expect(result).toEqual({ ok: true, status: 'already_stopped' })
    })

    it('isWorkspaceReachable returns false for stopped workspace', async () => {
      const { isWorkspaceReachable } = await import('../workspace-host')
      expect(await isWorkspaceReachable('local')).toBe(false)
    })
  })

  describe('isWorkspaceReachable', () => {
    beforeEach(() => {
      delete process.env.ARCHE_RUNTIME_MODE
    })

    it('returns false when no instance found', async () => {
      const { getInstanceStatus } = await import('@/lib/spawner/core')
      vi.mocked(getInstanceStatus).mockResolvedValue(null)

      const { isWorkspaceReachable } = await import('../workspace-host')
      expect(await isWorkspaceReachable('unknown')).toBe(false)
    })

    it('returns true when workspace status is running', async () => {
      const { getInstanceStatus } = await import('@/lib/spawner/core')
      vi.mocked(getInstanceStatus).mockResolvedValue({
        status: 'running',
        startedAt: new Date(),
        stoppedAt: null,
        lastActivityAt: new Date(),
        containerId: 'c1',
        serverPassword: 'pwd',
      })

      const { isWorkspaceReachable } = await import('../workspace-host')
      expect(await isWorkspaceReachable('alice')).toBe(true)
    })

    it('returns false when workspace status is stopped', async () => {
      const { getInstanceStatus } = await import('@/lib/spawner/core')
      vi.mocked(getInstanceStatus).mockResolvedValue({
        status: 'stopped',
        startedAt: new Date(),
        stoppedAt: new Date(),
        lastActivityAt: null,
        containerId: null,
        serverPassword: 'pwd',
      })

      const { isWorkspaceReachable } = await import('../workspace-host')
      expect(await isWorkspaceReachable('alice')).toBe(false)
    })
  })
})

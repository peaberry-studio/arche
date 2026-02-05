import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockContainer = {
  id: 'container-123',
  start: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
  inspect: vi.fn(),
}

const mockDockerInstance = {
  createContainer: vi.fn().mockResolvedValue(mockContainer),
  getContainer: vi.fn().mockReturnValue(mockContainer),
  createVolume: vi.fn().mockResolvedValue({}),
}

vi.mock('dockerode', () => ({
  default: vi.fn(() => mockDockerInstance),
}))

vi.mock('@/lib/user-data', () => ({
  getUserDataHostPath: vi.fn((slug: string) => `/opt/arche/users/${slug}`),
  ensureUserDirectory: vi.fn().mockResolvedValue('/opt/arche/users/user-slug'),
}))

import Docker from 'dockerode'
import {
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  inspectContainer,
  isContainerRunning,
} from '../docker'

describe('docker', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.CONTAINER_PROXY_HOST = 'test-proxy'
    process.env.CONTAINER_PROXY_PORT = '2375'
    process.env.OPENCODE_IMAGE = 'test-image:latest'
    process.env.OPENCODE_NETWORK = 'test-network'
  })

  afterEach(() => {
    process.env = originalEnv
    vi.clearAllMocks()
  })

  describe('createContainer', () => {
    it('creates container with correct configuration', async () => {
      await createContainer('user-slug', 'secret-password')

      expect(Docker).toHaveBeenCalledWith({
        host: 'test-proxy',
        port: 2375,
      })

      expect(mockDockerInstance.createContainer).toHaveBeenCalledWith({
        Image: 'test-image:latest',
        name: 'opencode-user-slug',
        WorkingDir: '/workspace',
        Cmd: ['serve', '--hostname', '0.0.0.0', '--port', '4096'],
        Env: [
          'OPENCODE_SERVER_PASSWORD=secret-password',
          'OPENCODE_SERVER_USERNAME=opencode',
          'WORKSPACE_AGENT_PORT=4097',
        ],
        HostConfig: {
          NetworkMode: 'test-network',
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [
            'arche-workspace-user-slug:/workspace',
            '/opt/arche/users/user-slug:/user-data',
          ],
        },
        Labels: {
          'arche.managed': 'true',
          'arche.user.slug': 'user-slug',
        },
      })
    })

    it('returns the created container', async () => {
      const container = await createContainer('slug', 'pass')
      expect(container.id).toBe('container-123')
    })
  })

  describe('startContainer', () => {
    it('starts a container by ID', async () => {
      await startContainer('container-123')
      expect(mockContainer.start).toHaveBeenCalled()
    })
  })

  describe('stopContainer', () => {
    it('stops a container with 10s timeout', async () => {
      await stopContainer('container-123')
      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 10 })
    })
  })

  describe('removeContainer', () => {
    it('removes a container with force option', async () => {
      await removeContainer('container-123')
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true })
    })
  })

  describe('inspectContainer', () => {
    it('returns container inspection data', async () => {
      mockContainer.inspect.mockResolvedValue({ State: { Running: true } })
      const info = await inspectContainer('container-123')
      expect(info).toEqual({ State: { Running: true } })
    })
  })

  describe('isContainerRunning', () => {
    it('returns true when container is running', async () => {
      mockContainer.inspect.mockResolvedValue({ State: { Running: true } })
      const running = await isContainerRunning('container-123')
      expect(running).toBe(true)
    })

    it('returns false when container is not running', async () => {
      mockContainer.inspect.mockResolvedValue({ State: { Running: false } })
      const running = await isContainerRunning('container-123')
      expect(running).toBe(false)
    })

    it('returns false when inspection fails', async () => {
      mockContainer.inspect.mockRejectedValue(new Error('Container not found'))
      const running = await isContainerRunning('container-123')
      expect(running).toBe(false)
    })
  })
})

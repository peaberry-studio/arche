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

const mockDockerConstructor = vi.fn(() => mockDockerInstance)

vi.mock('dockerode', () => ({
  default: mockDockerConstructor,
}))

const mockWriteFile = vi.fn().mockResolvedValue(undefined)
const mockChmod = vi.fn().mockResolvedValue(undefined)
const mockMkdir = vi.fn().mockResolvedValue(undefined)
const mockRm = vi.fn().mockResolvedValue(undefined)
vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
}))

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
}))

vi.mock('@/lib/user-data', () => ({
  getUserDataHostPath: vi.fn((slug: string) => `/opt/arche/users/${slug}`),
  ensureUserDirectory: vi.fn().mockResolvedValue('/opt/arche/users/user-slug'),
}))

import {
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  removeManagedContainerForSlug,
  inspectContainer,
  isContainerRunning,
} from '../docker'

describe('docker', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CONTAINER_SOCKET_PATH
    process.env.CONTAINER_PROXY_HOST = 'test-proxy'
    process.env.CONTAINER_PROXY_PORT = '2375'
    process.env.OPENCODE_IMAGE = 'test-image:latest'
    process.env.OPENCODE_NETWORK = 'test-network'
    process.env.KB_CONTENT_HOST_PATH = '/opt/arche/kb-content'
  })

  afterEach(() => {
    process.env = originalEnv
    vi.clearAllMocks()
  })

  describe('createContainer', () => {
    it('creates container with default runtime configuration', async () => {
      await createContainer('user-slug', 'secret-password')

      const configCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          (call[0] as string).endsWith('opencode-config.json')
      )
      const writtenConfig = JSON.parse(String(configCall?.[1])) as {
        permission?: {
          edit?: Record<string, string>
          bash?: Record<string, string>
        }
        provider?: {
          fireworks?: { options?: { baseURL?: string } }
          'fireworks-ai'?: { options?: { baseURL?: string } }
        }
      }
      expect(writtenConfig.permission?.edit).toMatchObject({
        '.gitignore': 'deny',
        '.gitkeep': 'deny',
        '**/.gitkeep': 'deny',
        'opencode.json': 'deny',
        'AGENTS.md': 'deny',
        'node_modules/*': 'deny',
      })
      expect(writtenConfig.permission?.bash).toMatchObject({
        '*AGENTS.md*': 'deny',
        '*.gitkeep*': 'deny',
        'npm install*': 'deny',
        'pnpm add*': 'deny',
        'yarn create*': 'deny',
        'bun init*': 'deny',
      })
      expect(writtenConfig.provider?.fireworks?.options?.baseURL).toBe(
        'http://web:3000/api/internal/providers/fireworks'
      )
      expect(writtenConfig.provider?.['fireworks-ai']?.options?.baseURL).toBe(
        'http://web:3000/api/internal/providers/fireworks'
      )

      expect(mockDockerConstructor).toHaveBeenCalledWith({
        host: 'test-proxy',
        port: 2375,
      })

      // Config is written to user-data as a file (not as env var)
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/opt/arche/users/user-slug/opencode-config.json',
        expect.any(String),
        'utf-8'
      )

      expect(mockDockerInstance.createVolume).toHaveBeenCalledWith({ Name: 'arche-workspace-user-slug' })
      expect(mockDockerInstance.createVolume).toHaveBeenCalledWith({ Name: 'arche-opencode-share-user-slug' })
      expect(mockDockerInstance.createVolume).toHaveBeenCalledWith({ Name: 'arche-opencode-state-user-slug' })

      expect(mockDockerInstance.createContainer).toHaveBeenCalledWith({
        Image: 'test-image:latest',
        name: 'opencode-user-slug',
        WorkingDir: '/workspace',
        Cmd: ['serve', '--hostname', '0.0.0.0', '--port', '4096'],
        Env: expect.arrayContaining([
          'OPENCODE_SERVER_PASSWORD=secret-password',
          'OPENCODE_SERVER_USERNAME=opencode',
          'OPENCODE_CONFIG_DIR=/opt/arche/opencode-config',
          'HOME=/home/workspace',
          'XDG_DATA_HOME=/home/workspace/.local/share',
          'XDG_CONFIG_HOME=/home/workspace/.config',
          'XDG_STATE_HOME=/home/workspace/.local/state',
          'WORKSPACE_AGENT_PORT=4097',
          'WORKSPACE_GIT_AUTHOR_NAME=user-slug',
          'WORKSPACE_GIT_AUTHOR_EMAIL=user-slug@arche.local',
        ]),
        HostConfig: {
          NetworkMode: 'test-network',
          RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
          Binds: [
            'arche-workspace-user-slug:/workspace',
            'arche-opencode-share-user-slug:/home/workspace/.local/share/opencode',
            'arche-opencode-state-user-slug:/home/workspace/.local/state/opencode',
            '/opt/arche/kb-content:/kb-content',
            '/opt/arche/users/user-slug:/tmp/arche-user-data:ro',
          ],
        },
        Labels: {
          'arche.managed': 'true',
          'arche.user.slug': 'user-slug',
        },
      })
    })

    it('writes the provided runtime config content without mutating it', async () => {
      const configContent = JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        permission: {
          bash: {
            '*': 'ask',
            'git *': 'allow',
          },
          edit: {
            '*': 'allow',
            'Company/*': 'allow',
          },
        },
      })

      await createContainer('user-slug', 'secret-password', configContent)

      const configCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          (call[0] as string).endsWith('opencode-config.json')
      )
      const writtenConfig = JSON.parse(String(configCall?.[1])) as {
        permission?: {
          edit?: Record<string, string>
          bash?: Record<string, string>
        }
      }

      expect(writtenConfig.permission?.bash).toMatchObject({
        '*': 'ask',
        'git *': 'allow',
      })
      expect(writtenConfig.permission?.edit).toMatchObject({
        '*': 'allow',
        'Company/*': 'allow',
      })
    })

    it('writes AGENTS.md to user-data when agentsMd is provided', async () => {
      const agentsContent = '# My Agents\n\nSome agent config'

      await createContainer('user-slug', 'secret-password', undefined, agentsContent)

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/opt/arche/users/user-slug/AGENTS.md',
        agentsContent,
        'utf-8'
      )

      expect(mockDockerInstance.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Binds: expect.arrayContaining([
              '/opt/arche/users/user-slug:/tmp/arche-user-data:ro',
            ]),
          }),
        })
      )
    })

    it('does not write AGENTS.md when agentsMd is not provided', async () => {
      await createContainer('user-slug', 'secret-password')

      const agentsCalls = mockWriteFile.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).endsWith('AGENTS.md')
      )
      expect(agentsCalls).toHaveLength(0)
    })

    it('writes runtime skills to the user-data directory when provided', async () => {
      await createContainer('user-slug', 'secret-password', undefined, undefined, [
        {
          skill: {
            frontmatter: {
              name: 'pdf-processing',
              description: 'Handle PDFs',
            },
            body: 'Use this for PDFs.',
            raw: '',
          },
          files: [
            {
              path: 'SKILL.md',
              content: new TextEncoder().encode('---\nname: pdf-processing\ndescription: Handle PDFs\n---\nUse this for PDFs.'),
            },
          ],
        },
      ])

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/opt/arche/users/user-slug/skills/pdf-processing/SKILL.md',
        expect.any(Buffer)
      )
    })

    it('returns the created container', async () => {
      const container = await createContainer('slug', 'pass')
      expect(container.id).toBe('container-123')
    })

    it('uses provided git author identity when passed', async () => {
      await createContainer('user-slug', 'secret-password', undefined, undefined, undefined, {
        name: 'alice',
        email: 'alice@example.com',
      })

      expect(mockDockerInstance.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: expect.arrayContaining([
            'WORKSPACE_GIT_AUTHOR_NAME=alice',
            'WORKSPACE_GIT_AUTHOR_EMAIL=alice@example.com',
          ]),
        })
      )
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

  describe('removeManagedContainerForSlug', () => {
    it('removes a managed container matching the slug', async () => {
      mockContainer.inspect.mockResolvedValue({
        Config: {
          Labels: {
            'arche.managed': 'true',
            'arche.user.slug': 'user-slug',
          },
        },
      })

      const removed = await removeManagedContainerForSlug('user-slug')

      expect(removed).toBe(true)
      expect(mockDockerInstance.getContainer).toHaveBeenCalledWith('opencode-user-slug')
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true })
    })

    it('does not remove an unmanaged container using the same name', async () => {
      mockContainer.inspect.mockResolvedValue({
        Config: {
          Labels: {
            'arche.managed': 'false',
            'arche.user.slug': 'user-slug',
          },
        },
      })

      const removed = await removeManagedContainerForSlug('user-slug')

      expect(removed).toBe(false)
      expect(mockContainer.remove).not.toHaveBeenCalled()
    })

    it('returns false when no matching container exists', async () => {
      mockContainer.inspect.mockRejectedValue(new Error('not found'))

      const removed = await removeManagedContainerForSlug('user-slug')

      expect(removed).toBe(false)
      expect(mockContainer.remove).not.toHaveBeenCalled()
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

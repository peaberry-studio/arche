import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockContainer = {
  id: 'container-123',
  start: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
  inspect: vi.fn(),
}

const mockImage = { inspect: vi.fn() }

const mockDockerInstance = {
  createContainer: vi.fn().mockResolvedValue(mockContainer),
  getContainer: vi.fn().mockReturnValue(mockContainer),
  createVolume: vi.fn().mockResolvedValue({}),
  listContainers: vi.fn(),
  getImage: vi.fn().mockReturnValue(mockImage),
  pull: vi.fn(),
  modem: { followProgress: vi.fn() },
}

const mockDockerConstructor = vi.fn(function Docker() {
  return mockDockerInstance
})

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
  createArchiveContainer,
  findLegacyArchiveSource,
  hasLegacyBackendWriters,
  removeOrphanedV2ContainerForSlug,
  removeManagedArchiveContainerForSlug,
  startContainer,
  stopContainer,
  removeContainer,
  removeManagedContainerForSlug,
  inspectContainer,
  isContainerRunning,
} from '@/lib/spawner/docker'

describe('docker', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CONTAINER_SOCKET_PATH
    process.env.CONTAINER_PROXY_HOST = 'test-proxy'
    process.env.CONTAINER_PROXY_PORT = '2375'
    process.env.OPENCODE_IMAGE = 'test-image:latest'
    process.env.OPENCODE_V1_IMAGE = 'test-image:opencode-v1'
    process.env.OPENCODE_NETWORK = 'test-network'
    process.env.KB_CONTENT_HOST_PATH = '/opt/arche/kb-content'
    mockDockerInstance.listContainers.mockResolvedValue([])
    mockDockerInstance.getContainer.mockReturnValue(mockContainer)
    mockContainer.inspect.mockRejectedValue({ statusCode: 404 })
    mockContainer.remove.mockResolvedValue(undefined)
    mockImage.inspect.mockResolvedValue({})
    process.env.DATABASE_URL = 'postgresql://current:fixture@postgres:5432/arche?schema=public'
  })

  describe('runtime upgrade writers', () => {
    function backend(labels: Record<string, string>, databaseUrl: string, running = true) {
      mockDockerInstance.listContainers.mockResolvedValue([{
        Id: 'backend', Labels: labels, NetworkSettings: { Networks: { 'test-network': {} } },
      }])
      mockContainer.inspect.mockResolvedValue({ State: { Running: running }, Config: { Env: [`DATABASE_URL=${databaseUrl}`] } })
    }

    it.each(['web', 'flows', 'reaper'])('waits for an old %s backend using the same database regardless of credentials', async (service) => {
      backend({ 'com.docker.compose.service': service }, 'postgres://previous:old-fixture@POSTGRES/arche')
      await expect(hasLegacyBackendWriters()).resolves.toBe(true)
    })

    it('waits for old blue-green web containers outside compose', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      backend({ 'arche.role': 'web' }, process.env.DATABASE_URL!)
      await expect(hasLegacyBackendWriters()).resolves.toBe(true)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('runtime contract'), { container: 'backend' })
      warn.mockRestore()
    })

    it.each([
      'postgresql://fixture@postgres/another-db',
      'postgresql://fixture@other-postgres/arche',
      'postgresql://fixture@postgres:5433/arche',
      'postgresql://fixture@postgres/arche?schema=other',
    ])('ignores an old backend scoped to a different database: %s', async (databaseUrl) => {
      backend({ 'arche.role': 'web' }, databaseUrl)
      await expect(hasLegacyBackendWriters()).resolves.toBe(false)
    })

    it('allows only the current contract once all old backends are stopped', async () => {
      backend({ 'arche.role': 'web', 'arche.runtime.contract': 'opencode-v2' }, process.env.DATABASE_URL!)
      await expect(hasLegacyBackendWriters()).resolves.toBe(false)
      expect(mockContainer.inspect).not.toHaveBeenCalled()
      backend({ 'arche.role': 'web' }, process.env.DATABASE_URL!, false)
      await expect(hasLegacyBackendWriters()).resolves.toBe(false)
    })

    it('does not confuse service DNS in an unrelated stack with the workspace database', async () => {
      backend({ 'arche.role': 'web' }, process.env.DATABASE_URL!)
      mockDockerInstance.listContainers.mockResolvedValue([{
        Id: 'unrelated', Labels: { 'arche.role': 'web' }, NetworkSettings: { Networks: { other: {} } },
      }])
      await expect(hasLegacyBackendWriters()).resolves.toBe(false)
      expect(mockContainer.inspect).not.toHaveBeenCalled()
    })

    it('fails closed on unavailable inventory or an uncertain old backend', async () => {
      mockDockerInstance.listContainers.mockRejectedValueOnce(new Error('proxy unavailable'))
      await expect(hasLegacyBackendWriters()).rejects.toThrow('proxy unavailable')
      backend({ 'arche.role': 'web' }, process.env.DATABASE_URL!)
      mockContainer.inspect.mockRejectedValueOnce(new Error('inspection unavailable'))
      await expect(hasLegacyBackendWriters()).rejects.toThrow('inspection unavailable')
      mockContainer.inspect.mockResolvedValueOnce({ State: { Running: true }, Config: { Env: [] } })
      await expect(hasLegacyBackendWriters()).rejects.toThrow('runtime_upgrade_database_unavailable')
    })
  })

  afterEach(() => {
    process.env = originalEnv
    vi.clearAllMocks()
  })

  describe('createContainer', () => {
    const ownedSource = {
      Id: 'source', Name: '/opencode-user-slug', State: { Running: true },
      Config: { Labels: { 'arche.managed': 'true', 'arche.user.slug': 'user-slug' } },
    }

    it.each([null, 'stale-pointer'])('discovers the owned running source independently of pointer %s', async (pointer) => {
      mockDockerInstance.listContainers.mockResolvedValue([{ Id: 'source', Labels: ownedSource.Config.Labels }])
      mockContainer.inspect.mockImplementation(async function () { throw { statusCode: 404 } })
      mockDockerInstance.getContainer.mockImplementation((id: string) => ({
        ...mockContainer, inspect: async () => {
          if (id !== 'source') throw { statusCode: 404 }
          return { ...ownedSource, Name: '/renamed-source' }
        },
      }))
      await expect(findLegacyArchiveSource('user-slug', pointer)).resolves.toEqual({ id: 'source', name: 'renamed-source', running: true })
      expect(mockDockerInstance.listContainers).toHaveBeenCalledWith({ all: true, filters: { label: ['arche.managed=true', 'arche.user.slug=user-slug'] } })
    })

    it('never mounts a helper while any owned source remains, running or stopped', async () => {
      for (const running of [true, false]) {
        mockContainer.inspect.mockResolvedValue({ ...ownedSource, State: { Running: running } })
        await expect(createArchiveContainer('user-slug', 'fixture')).rejects.toThrow('legacy_archive_source_not_removed')
      }
      expect(mockDockerInstance.createContainer).not.toHaveBeenCalled()
    })

    it('allows a helper only on confirmed source absence, not uncertain inspections or inventory', async () => {
      mockContainer.inspect.mockRejectedValueOnce(new Error('proxy down'))
      await expect(createArchiveContainer('user-slug', 'fixture')).rejects.toThrow('proxy down')
      mockDockerInstance.listContainers.mockRejectedValueOnce(new Error('inventory unavailable'))
      await expect(createArchiveContainer('user-slug', 'fixture')).rejects.toThrow('inventory unavailable')
      expect(mockDockerInstance.createContainer).not.toHaveBeenCalled()
    })

    it.each([
      { labels: { 'arche.managed': 'true', 'arche.user.slug': 'other' }, error: 'legacy_archive_source_not_owned_v1' },
      { labels: { ...ownedSource.Config.Labels, 'arche.runtime.kind': 'opencode-v2' }, error: 'legacy_archive_source_not_owned_v1' },
    ])('fails closed on uncertain source ownership: $error', async ({ labels, error }) => {
      mockContainer.inspect.mockResolvedValue({ ...ownedSource, Config: { Labels: labels } })
      await expect(findLegacyArchiveSource('user-slug', null)).rejects.toThrow(error)
    })

    it('rejects incomplete inspections and multiple owned sources', async () => {
      mockContainer.inspect.mockResolvedValueOnce({ ...ownedSource, State: {} })
      await expect(findLegacyArchiveSource('user-slug', null)).rejects.toThrow('legacy_archive_source_inspection_incomplete')
      mockContainer.inspect.mockResolvedValueOnce(ownedSource).mockResolvedValueOnce({ ...ownedSource, Id: 'second' })
      await expect(findLegacyArchiveSource('user-slug', 'second')).rejects.toThrow('legacy_archive_multiple_sources')
    })

    it('boots legacy archive mode without project config, providers, MCP, startup scripts or writable workspace', async () => {
      const result = await createArchiveContainer('user-slug', 'archive-only')
      expect(result).toEqual({ id: 'container-123', name: 'opencode-archive-user-slug' })
      expect(mockDockerInstance.createContainer).toHaveBeenCalledWith(expect.objectContaining({
        Image: 'test-image:opencode-v1',
        Entrypoint: ['opencode'],
        Env: expect.arrayContaining([
          'OPENCODE_DISABLE_PROJECT_CONFIG=true',
          'OPENCODE_CONFIG_CONTENT={"mcp":{},"plugin":[],"enabled_providers":[]}',
          'XDG_CONFIG_HOME=/tmp/arche-archive-config',
          'GIT_CONFIG_COUNT=1',
          'GIT_CONFIG_KEY_0=safe.directory',
          'GIT_CONFIG_VALUE_0=/workspace',
        ]),
        HostConfig: {
          NetworkMode: 'test-network', RestartPolicy: { Name: 'no' },
          Binds: [
            'arche-workspace-user-slug:/workspace:ro',
            'arche-opencode-share-user-slug:/home/workspace/.local/share/opencode',
            'arche-opencode-state-user-slug:/home/workspace/.local/state/opencode',
          ],
        },
        Labels: expect.objectContaining({ 'arche.archive': 'true' }),
      }))
      expect(mockWriteFile).not.toHaveBeenCalled()
      expect(mockDockerInstance.createVolume).not.toHaveBeenCalled()
    })

    it('pulls a missing legacy image to completion before creating the archive helper', async () => {
      mockImage.inspect.mockRejectedValueOnce({ statusCode: 404 })
      const stream = { fixture: true }
      mockDockerInstance.pull.mockResolvedValueOnce(stream)
      mockDockerInstance.modem.followProgress.mockImplementationOnce((_stream, done) => done(null))
      await createArchiveContainer('user-slug', 'fixture')
      expect(mockDockerInstance.pull).toHaveBeenCalledExactlyOnceWith('test-image:opencode-v1')
      expect(mockDockerInstance.modem.followProgress).toHaveBeenCalledWith(stream, expect.any(Function))
      expect(mockDockerInstance.pull.mock.invocationCallOrder[0]).toBeLessThan(mockDockerInstance.createContainer.mock.invocationCallOrder[0])
    })

    it('does not create the archive helper when image inspection or pulling fails', async () => {
      mockImage.inspect.mockRejectedValueOnce(new Error('image inspection unavailable'))
      await expect(createArchiveContainer('user-slug', 'fixture')).rejects.toThrow('image inspection unavailable')
      expect(mockDockerInstance.pull).not.toHaveBeenCalled()
      mockImage.inspect.mockRejectedValueOnce({ statusCode: 404 })
      mockDockerInstance.pull.mockResolvedValueOnce({})
      mockDockerInstance.modem.followProgress.mockImplementationOnce((_stream, done) => done(new Error('registry unavailable')))
      await expect(createArchiveContainer('user-slug', 'fixture')).rejects.toThrow('registry unavailable')
      expect(mockDockerInstance.createContainer).not.toHaveBeenCalled()
    })

    it('removes only an owned V2 orphan before legacy source discovery', async () => {
      mockContainer.inspect.mockResolvedValue({ Id: 'orphan', Config: { Labels: {
        'arche.managed': 'true', 'arche.user.slug': 'user-slug', 'arche.runtime.kind': 'opencode-v2',
      } } })
      await removeOrphanedV2ContainerForSlug('user-slug')
      expect(mockDockerInstance.getContainer).toHaveBeenLastCalledWith('orphan')
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true })
    })

    it.each([
      { 'arche.managed': 'true', 'arche.user.slug': 'user-slug' },
      { 'arche.managed': 'true', 'arche.user.slug': 'other', 'arche.runtime.kind': 'opencode-v2' },
      { 'arche.managed': 'false', 'arche.user.slug': 'user-slug', 'arche.runtime.kind': 'opencode-v2' },
    ])('never removes a V1 source or another container while recovering an orphan (%j)', async (labels) => {
      mockContainer.inspect.mockResolvedValue({ Id: 'source', Config: { Labels: labels } })
      await removeOrphanedV2ContainerForSlug('user-slug')
      expect(mockContainer.remove).not.toHaveBeenCalled()
    })

    it('fails orphan recovery when the container cannot be inspected or removed', async () => {
      mockContainer.inspect.mockRejectedValueOnce(new Error('inspection unavailable'))
      await expect(removeOrphanedV2ContainerForSlug('user-slug')).rejects.toThrow('inspection unavailable')
      mockContainer.inspect.mockResolvedValueOnce({ Id: 'orphan', Config: { Labels: {
        'arche.managed': 'true', 'arche.user.slug': 'user-slug', 'arche.runtime.kind': 'opencode-v2',
      } } })
      mockContainer.remove.mockRejectedValueOnce(new Error('removal unconfirmed'))
      await expect(removeOrphanedV2ContainerForSlug('user-slug')).rejects.toThrow('removal unconfirmed')
    })

    it('reclaims only an owned archive container left by an interrupted migration', async () => {
      mockDockerInstance.createContainer.mockRejectedValueOnce(new Error('container name is already in use'))
      mockContainer.inspect.mockRejectedValueOnce({ statusCode: 404 })
      mockContainer.inspect.mockResolvedValueOnce({ Config: { Labels: {
        'arche.managed': 'true', 'arche.user.slug': 'user-slug', 'arche.archive': 'true',
      } } })
      await createArchiveContainer('user-slug', 'fixture')
      expect(mockDockerInstance.getContainer).toHaveBeenCalledWith('opencode-archive-user-slug')
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true })
      expect(mockDockerInstance.createContainer).toHaveBeenCalledTimes(2)
    })

    it('never removes an unmanaged archive-name conflict', async () => {
      mockDockerInstance.createContainer.mockRejectedValueOnce(new Error('container name is already in use'))
      mockContainer.inspect.mockRejectedValueOnce({ statusCode: 404 })
      mockContainer.inspect.mockResolvedValueOnce({ Config: { Labels: { 'arche.managed': 'true', 'arche.user.slug': 'other', 'arche.archive': 'true' } } })
      await expect(createArchiveContainer('user-slug', 'fixture')).rejects.toThrow('archive_container_not_managed')
      expect(mockContainer.remove).not.toHaveBeenCalled()
    })

    it('confirms absence of an archive helper but never treats inspection failures as absence', async () => {
      mockContainer.inspect.mockRejectedValueOnce({ statusCode: 404 })
      await expect(removeManagedArchiveContainerForSlug('user-slug')).resolves.toBeUndefined()
      mockContainer.inspect.mockRejectedValueOnce(new Error('proxy down'))
      await expect(removeManagedArchiveContainerForSlug('user-slug')).rejects.toThrow('proxy down')
      expect(mockContainer.remove).not.toHaveBeenCalled()
    })

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
          huggingface?: { options?: { baseURL?: string } }
        }
      }
      expect(writtenConfig.permission?.edit).toMatchObject({
        '.gitignore': 'deny',
        '.gitkeep': 'deny',
        '**/.gitkeep': 'deny',
        'opencode.json': 'deny',
        '**/.opencode/**': 'deny',
        'AGENTS.md': 'deny',
        'node_modules/*': 'deny',
      })
      expect(writtenConfig.permission?.bash).toMatchObject({
        '*AGENTS.md*': 'deny',
        '*.opencode*': 'deny',
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
      expect(writtenConfig.provider?.huggingface?.options?.baseURL).toBe(
        'http://web:3000/api/internal/providers/huggingface'
      )
      expect(writtenConfig.provider?.zai?.options?.baseURL).toBe(
        'http://web:3000/api/internal/providers/zai'
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
      expect(mockDockerInstance.createVolume).toHaveBeenCalledWith({ Name: 'arche-opencode2-share-user-slug' })
      expect(mockDockerInstance.createVolume).toHaveBeenCalledWith({ Name: 'arche-opencode2-state-user-slug' })
      expect(mockDockerInstance.createVolume).not.toHaveBeenCalledWith({ Name: 'arche-opencode-share-user-slug' })
      expect(mockDockerInstance.createVolume).not.toHaveBeenCalledWith({ Name: 'arche-opencode-state-user-slug' })

      expect(mockDockerInstance.createContainer).toHaveBeenCalledWith({
        Image: 'test-image:latest',
        name: 'opencode-user-slug',
        WorkingDir: '/workspace',
        Cmd: ['serve', '--hostname', '0.0.0.0', '--port', '4096'],
        Env: expect.arrayContaining([
          'OPENCODE_SERVER_PASSWORD=secret-password',
          'OPENCODE_SERVER_USERNAME=opencode',
          'HOME=/home/workspace',
          'XDG_DATA_HOME=/home/workspace/.local/share',
          'XDG_CONFIG_HOME=/home/workspace/.config',
          'XDG_STATE_HOME=/home/workspace/.local/state',
          'WORKSPACE_AGENT_PORT=4097',
          'WORKSPACE_GIT_AUTHOR_NAME=user-slug',
          'WORKSPACE_GIT_AUTHOR_EMAIL=user-slug@arche.local',
          'OPENCODE_MODELS_URL=http://web:3000/api/internal/models',
          'ARCHE_SCRATCH_DIR=/tmp/arche-scratch',
        ]),
        HostConfig: {
          NetworkMode: 'test-network',
          RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
          Binds: [
            'arche-workspace-user-slug:/workspace',
            'arche-opencode2-share-user-slug:/home/workspace/.local/share/opencode',
            'arche-opencode2-state-user-slug:/home/workspace/.local/state/opencode',
            '/opt/arche/kb-content:/kb-content',
            '/opt/arche/users/user-slug:/tmp/arche-user-data:ro',
          ],
          Tmpfs: { '/tmp/arche-scratch': 'rw,nosuid,nodev,size=512m,mode=1777' },
        },
        Labels: {
          'arche.managed': 'true',
          'arche.user.slug': 'user-slug',
          'arche.runtime.kind': 'opencode-v2',
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

    it('removes a managed container name conflict and retries create once', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        mockDockerInstance.createContainer.mockRejectedValueOnce(new Error('container name is already in use'))
        mockContainer.inspect.mockResolvedValue({
          Config: {
            Labels: {
              'arche.managed': 'true',
              'arche.user.slug': 'user-slug',
            },
          },
        })

        await expect(createContainer('user-slug', 'secret-password')).resolves.toBe(mockContainer)

        expect(mockDockerInstance.getContainer).toHaveBeenCalledWith('opencode-user-slug')
        expect(mockContainer.remove).toHaveBeenCalledWith({ force: true })
        expect(mockDockerInstance.createContainer).toHaveBeenCalledTimes(2)
      } finally {
        consoleWarnSpy.mockRestore()
      }
    })

    it('does not remove an unmanaged container after a name conflict', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        mockDockerInstance.createContainer.mockRejectedValueOnce(new Error('container name is already in use'))
        mockContainer.inspect.mockResolvedValue({
          Config: {
            Labels: {
              'arche.managed': 'false',
              'arche.user.slug': 'user-slug',
            },
          },
        })

        await expect(createContainer('user-slug', 'secret-password')).rejects.toThrow('container name is already in use')

        expect(mockContainer.remove).not.toHaveBeenCalled()
        expect(mockDockerInstance.createContainer).toHaveBeenCalledTimes(1)
      } finally {
        consoleWarnSpy.mockRestore()
      }
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
    it('confirms absence on 404 while preserving actual teardown errors', async () => {
      mockContainer.remove.mockRejectedValueOnce({ statusCode: 404 })
      await expect(removeContainer('missing')).resolves.toBeUndefined()
      mockContainer.remove.mockRejectedValueOnce({ statusCode: 500 })
      await expect(removeContainer('uncertain')).rejects.toEqual({ statusCode: 500 })
    })
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

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { ChildProcess } from 'child_process'

const mockSpawn = vi.fn()
const mockExecFile = vi.fn()
const mockExecFileSync = vi.fn()
const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockReadFile = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockRandomBytes = vi.fn()
const mockMkdir = vi.fn()
const mockRm = vi.fn()
const mockWriteFile = vi.fn()
const mockArchiveDesktopLegacySessions = vi.fn()
const mockCleanupDesktopLegacyArchive = vi.fn()

vi.mock('@/lib/runtime/desktop/legacy-archive', () => ({
  archiveDesktopLegacySessions: (...args: unknown[]) => mockArchiveDesktopLegacySessions(...args),
  cleanupDesktopLegacyArchive: (...args: unknown[]) => mockCleanupDesktopLegacyArchive(...args),
}))

vi.mock('@/lib/services/runtime-migration', () => ({
  settleRuntimeMigratedRuns: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/spawner/legacy-archive', () => ({
  withHistoryMigrationProgress: vi.fn((_slug: string, work: () => Promise<unknown>) => work()),
}))

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>()
  return {
    ...actual,
    randomBytes: (...args: unknown[]) => mockRandomBytes(...args),
  }
})

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}))

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  promises: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}))

vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}))

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: vi.fn(() => '/tmp/arche/kb-content'),
}))

const mockCreateWorkspaceAgentClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/workspace-agent/client', () => ({ createWorkspaceAgentClient: mockCreateWorkspaceAgentClient }))

vi.mock('@/lib/services', () => ({
  instanceService: {
    upsertStarting: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn().mockResolvedValue(undefined),
    setRunning: vi.fn().mockResolvedValue(undefined),
    setRunningIfCurrentDesktopStart: vi.fn().mockResolvedValue({ count: 1 }),
    setRuntimeKindIfCurrentDesktopStart: vi.fn().mockResolvedValue({ count: 1 }),
    setErrorIfCurrentDesktopStart: vi.fn().mockResolvedValue({ count: 1 }),
    setStoppedIfCurrentSnapshot: vi.fn().mockResolvedValue({ count: 1 }),
    setStopped: vi.fn().mockResolvedValue(undefined),
    findStatusBySlug: vi.fn().mockResolvedValue(null),
    findActiveInstances: vi.fn().mockResolvedValue([]),
  },
  providerService: {
    markWorkspaceRestartRequired: vi.fn().mockResolvedValue({ count: 0 }),
    clearWorkspaceRestartRequired: vi.fn().mockResolvedValue({ count: 0 }),
  },
  userService: {
    findIdentityBySlug: vi.fn().mockResolvedValue({
      id: 'local',
      slug: 'local',
      email: 'local@arche.local',
    }),
  },
}))

vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: vi.fn().mockResolvedValue({
    ok: true,
    content: JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'assistant',
      agent: {
        assistant: {
          mode: 'primary',
          tools: { task: true },
        },
      },
    }),
    hash: 'hash',
    path: '/tmp/arche/kb-config/CommonWorkspaceConfig.json',
  }),
  readConfigRepoFile: vi.fn().mockResolvedValue({ ok: false }),
}))

vi.mock('@/lib/config-repo-store', () => ({
  readConfigRepoSnapshot: vi.fn(async (reader: (context: { repoDir: string; hash: string | null }) => Promise<unknown>) => ({
    ok: true,
    hash: 'snapshot-hash',
    data: await reader({ repoDir: '/tmp/mock-config-repo', hash: 'snapshot-hash' }),
  })),
}))

vi.mock('@/lib/spawner/config', () => ({
  getWorkspaceAgentPort: vi.fn(() => 4097),
}))

vi.mock('@/lib/spawner/crypto', () => ({
  decryptPassword: vi.fn((p: string) => p.replace(/^enc:/, '')),
  encryptPassword: vi.fn((p: string) => `enc:${p}`),
}))

vi.mock('@/lib/harness/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/harness/registry')>()
  return {
    ...actual,
    checkRuntimeHealth: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    syncRuntimeProviderAccess: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
  }
})

vi.mock('@/lib/spawner/mcp-config', () => ({
  buildMcpConfigForSlug: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/skills/skill-store', () => ({
  readSkillBundlesFromRepoDir: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/spawner/runtime-config-hash', () => ({
  getRuntimeConfigHashForSlug: vi.fn().mockResolvedValue({ ok: true, hash: 'runtime-hash' }),
}))

const mockFetch = vi.fn()

type Listener = (...args: unknown[]) => void

function makeChildProcess(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const listeners = new Map<string, Listener[]>()

  const addListener = (event: string, cb: Listener) => {
    const current = listeners.get(event) ?? []
    listeners.set(event, [...current, cb])
  }

  const child = {
    killed: false,
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn(function kill(this: ChildProcess, signal?: string) {
      child.killed = true
      if (signal === 'SIGKILL') {
        Object.defineProperty(child, 'signalCode', { value: 'SIGKILL', configurable: true })
        child.emit('exit', null, 'SIGKILL')
      }
      return true
    }),
    on: vi.fn((event: string, cb: Listener) => {
      addListener(event, cb)
      return child
    }),
    once: vi.fn((event: string, cb: Listener) => {
      const wrapped: Listener = (...args) => {
        child.removeListener(event, wrapped)
        cb(...args)
      }
      addListener(event, wrapped)
      return child
    }),
    removeListener: vi.fn((event: string, cb: Listener) => {
      const current = listeners.get(event) ?? []
      listeners.set(event, current.filter((listener) => listener !== cb))
      return child
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      const current = [...(listeners.get(event) ?? [])]
      for (const listener of current) {
        listener(...args)
      }
      return current.length > 0
    }),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    ...overrides,
  } as unknown as ChildProcess & { emit: (event: string, ...args: unknown[]) => boolean }

  return child
}

function mockHealthyFetch() {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/global/health')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ healthy: true }),
      })
    }

    if (url.includes('/health')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, service: 'workspace-agent' }),
      })
    }

    return Promise.reject(new Error(`unexpected fetch ${url}`))
  })
}

describe('desktopWorkspaceHost', () => {
  const originalEnv = process.env
  const originalResourcesPath = process.resourcesPath

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    process.env = { ...originalEnv }
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    process.env.ARCHE_DATA_DIR = '/tmp/arche'
    delete process.env.ARCHE_OPENCODE_BIN
    delete process.env.ARCHE_OPENCODE_V1_BIN
    delete process.env.ARCHE_TOOLS_DIR
    delete process.env.ARCHE_NODE_BIN
    delete process.env.ARCHE_OPENCODE_DATA_DIR
    process.env.ARCHE_WORKSPACE_AGENT_BIN = '/mock/bin/workspace-agent'
    delete process.env.ARCHE_DESKTOP_WEB_PORT
    delete process.env.ARCHE_DESKTOP_START_TIMEOUT_MS
    delete process.env.ARCHE_DESKTOP_START_INTERVAL_MS
    delete process.env.ARCHE_ENABLE_E2E_HOOKS
    delete process.env.ARCHE_E2E_RUNTIME_BASE_URL
    delete process.env.ARCHE_E2E_RUNTIME_PASSWORD
    delete process.env.OPENCODE_SERVER_PASSWORD
    // @ts-expect-error test isolation
    process.resourcesPath = undefined
    mockExistsSync.mockImplementation((target: string) => target === '/mock/bin/workspace-agent')
    mockReadFile.mockImplementation((target: string) => {
      if (target.endsWith('/CommonWorkspaceConfig.json')) {
        return Promise.resolve(
          JSON.stringify({
            $schema: 'https://opencode.ai/config.json',
            default_agent: 'assistant',
            agent: {
              assistant: {
                mode: 'primary',
                tools: { task: true },
              },
            },
          })
        )
      }

      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      return Promise.reject(error)
    })
    mockReadFileSync.mockReturnValue('')
    mockRandomBytes.mockReturnValue({ toString: () => 'gen-pw' })
    mockMkdir.mockResolvedValue(undefined)
    mockRm.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockHealthyFetch()
    mockArchiveDesktopLegacySessions.mockResolvedValue({ ok: true, data: { archived: 2 } })
    mockCleanupDesktopLegacyArchive.mockResolvedValue(undefined)

    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.findStatusBySlug).mockResolvedValue(null)
    const { checkRuntimeHealth, syncRuntimeProviderAccess } = await import('@/lib/harness/registry')
    vi.mocked(checkRuntimeHealth).mockResolvedValue({ ok: true, data: {} })
    vi.mocked(syncRuntimeProviderAccess).mockResolvedValue({ ok: true, data: undefined })
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error test isolation
    process.resourcesPath = originalResourcesPath
  })

  it('starts opencode and workspace-agent and returns started status', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result).toEqual({ ok: true, status: 'started' })
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('skips real process startup in E2E fake mode and returns fake connections', async () => {
    process.env.ARCHE_ENABLE_E2E_HOOKS = '1'
    process.env.ARCHE_E2E_RUNTIME_BASE_URL = 'http://127.0.0.1:4210'
    process.env.ARCHE_E2E_RUNTIME_PASSWORD = 'fake-password'
    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.findStatusBySlug).mockResolvedValue({
      status: 'running',
      startedAt: new Date('2026-04-21T10:00:00.000Z'),
      stoppedAt: null,
      lastActivityAt: new Date('2026-04-21T10:00:00.000Z'),
      containerId: null,
      serverPassword: 'enc:fake-password',
      runtimeKind: null,
      providerSyncHash: null,
      providerSyncedAt: null,
    })

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result).toEqual({ ok: true, status: 'started' })
    expect(mockSpawn).not.toHaveBeenCalled()
    expect(await desktopWorkspaceHost.getConnection('local')).toEqual({
      baseUrl: 'http://127.0.0.1:4210',
      authHeader: expect.any(String),
    })
    expect(await desktopWorkspaceHost.getAgentConnection('local')).toEqual({
      baseUrl: 'http://127.0.0.1:4210',
      authHeader: expect.any(String),
    })
  })

  it('stores the applied runtime config hash after successful startup', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const { instanceService } = await import('@/lib/services')
    expect(instanceService.setRunningIfCurrentDesktopStart).toHaveBeenCalledWith(
      'local',
      expect.any(Date),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      'opencode-v2',
    )
  })

  it('does not publish running when the desktop start was superseded', async () => {
    const opencodeChild = makeChildProcess({ exitCode: 0 })
    const workspaceAgentChild = makeChildProcess({ exitCode: 0 })
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)
    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.setRunningIfCurrentDesktopStart).mockResolvedValueOnce({ count: 0 })
    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await expect(desktopWorkspaceHost.start('local', 'user-1')).resolves.toMatchObject({ ok: false, error: 'start_failed' })
    expect(opencodeChild.kill).toHaveBeenCalledWith('SIGTERM')
    expect(workspaceAgentChild.kill).toHaveBeenCalledWith('SIGTERM')
    expect(instanceService.setRunning).not.toHaveBeenCalled()
    expect(instanceService.setStopped).not.toHaveBeenCalled()
    expect(instanceService.setError).not.toHaveBeenCalled()
  })

  const LEGACY_SHARE_DIR = '/tmp/arche/.runtime/opencode/.local/share/opencode'

  async function prepareLegacyVault() {
    mockExistsSync.mockImplementation((target: string) => target === '/mock/bin/workspace-agent' || target === LEGACY_SHARE_DIR)
    const artifacts = await import('@/lib/spawner/runtime-artifacts')
    const build = vi.spyOn(artifacts, 'buildWorkspaceRuntimeArtifacts').mockResolvedValue({
      owner: null, skills: [], opencodeConfigContent: '{"agents":{}}',
    })
    return { build }
  }

  it('starts a vault without legacy OpenCode 1 data without archiving', async () => {
    mockSpawn.mockReturnValueOnce(makeChildProcess()).mockReturnValueOnce(makeChildProcess())
    const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
    const { instanceService } = await import('@/lib/services')

    await expect(desktopWorkspaceHost.start('local', 'user-1')).resolves.toEqual({ ok: true, status: 'started' })
    expect(mockArchiveDesktopLegacySessions).not.toHaveBeenCalled()
    expect(mockSpawn.mock.calls[0][0]).toBe('opencode')
    expect(instanceService.setRuntimeKindIfCurrentDesktopStart).toHaveBeenCalledWith('local', expect.any(Date), 'opencode-v2')
  })

  it('archives legacy history before starting OpenCode 2, keeps legacy data intact and records the kind before health', async () => {
    const { build } = await prepareLegacyVault()
    mockSpawn.mockReturnValueOnce(makeChildProcess()).mockReturnValueOnce(makeChildProcess())
    const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
    const { instanceService } = await import('@/lib/services')
    const { settleRuntimeMigratedRuns } = await import('@/lib/services/runtime-migration')
    const { checkRuntimeHealth } = await import('@/lib/harness/registry')

    await expect(desktopWorkspaceHost.start('local', 'user-1')).resolves.toEqual({ ok: true, status: 'started' })
    expect(mockArchiveDesktopLegacySessions).toHaveBeenCalledWith(expect.objectContaining({
      dataDir: '/tmp/arche/.runtime/opencode', workspaceDir: '/tmp/arche/workspace', slug: 'local',
    }))
    expect(mockSpawn.mock.calls[0][0]).toBe('opencode')
    expect(mockSpawn.mock.calls[0][2].env).toMatchObject({
      HOME: '/tmp/arche/.runtime/opencode-v2',
      XDG_DATA_HOME: '/tmp/arche/.runtime/opencode-v2/.local/share',
      XDG_STATE_HOME: '/tmp/arche/.runtime/opencode-v2/.local/state',
      OPENCODE_PASSWORD: 'gen-pw',
      OPENCODE_MODELS_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/api\/internal\/models$/),
    })
    expect(build).toHaveBeenCalledWith('local', expect.any(Object), expect.not.objectContaining({ runtimeKind: expect.anything() }))
    expect(settleRuntimeMigratedRuns).toHaveBeenCalledWith('local')
    expect(instanceService.setRuntimeKindIfCurrentDesktopStart).toHaveBeenCalledWith('local', expect.any(Date), 'opencode-v2')
    expect(mockArchiveDesktopLegacySessions.mock.invocationCallOrder[0]).toBeLessThan(mockSpawn.mock.invocationCallOrder[0])
    expect(vi.mocked(instanceService.setRuntimeKindIfCurrentDesktopStart).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(checkRuntimeHealth).mock.invocationCallOrder[0])
    expect(instanceService.setRunningIfCurrentDesktopStart).toHaveBeenCalledWith('local', expect.any(Date), expect.any(String), 'opencode-v2')
  })

  it('fails the start after an export error, without settling runs or starting any runtime', async () => {
    await prepareLegacyVault()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockArchiveDesktopLegacySessions.mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })
    const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
    await expect(desktopWorkspaceHost.start('local', 'user-1')).resolves.toEqual({
      ok: false, error: 'start_failed', detail: 'legacy_archive_failed: runtime_error',
    })
    expect(mockSpawn).not.toHaveBeenCalled()
    const { instanceService } = await import('@/lib/services')
    expect(instanceService.setErrorIfCurrentDesktopStart).toHaveBeenCalledWith('local', expect.any(Date))
    expect(instanceService.setRuntimeKindIfCurrentDesktopStart).not.toHaveBeenCalled()
    const { settleRuntimeMigratedRuns } = await import('@/lib/services/runtime-migration')
    expect(settleRuntimeMigratedRuns).not.toHaveBeenCalled()
  })

  it('fails the start when OpenCode 2 cannot express the vault config', async () => {
    const { build } = await prepareLegacyVault()
    const { RuntimeConfigRenderError } = await import('@/lib/harness/runtime-config')
    build.mockRejectedValue(new RuntimeConfigRenderError({ code: 'runtime_config_unsupported', path: 'agents.assistant.color', message: 'Unsupported configuration' }))
    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.findStatusBySlug).mockResolvedValue({
      status: 'stopped', startedAt: new Date(1), stoppedAt: new Date(2), lastActivityAt: null,
      containerId: null, serverPassword: 'enc:pw', runtimeKind: 'opencode-v2',
      providerSyncHash: null, providerSyncedAt: null,
    })
    const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
    await expect(desktopWorkspaceHost.start('local', 'user-1')).resolves.toMatchObject({ ok: false, error: 'start_failed' })
    expect(instanceService.setErrorIfCurrentDesktopStart).toHaveBeenCalledWith('local', expect.any(Date))
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('starts a vault already on OpenCode 2 without re-exporting legacy history', async () => {
    await prepareLegacyVault()
    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.findStatusBySlug).mockResolvedValue({
      status: 'stopped', startedAt: new Date(1), stoppedAt: new Date(2), lastActivityAt: null,
      containerId: null, serverPassword: 'enc:pw', runtimeKind: 'opencode-v2',
      providerSyncHash: null, providerSyncedAt: null,
    })
    mockSpawn.mockReturnValueOnce(makeChildProcess()).mockReturnValueOnce(makeChildProcess())
    const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
    await expect(desktopWorkspaceHost.start('local', 'user-1')).resolves.toEqual({ ok: true, status: 'started' })
    expect(mockArchiveDesktopLegacySessions).not.toHaveBeenCalled()
    expect(mockSpawn.mock.calls[0][0]).toBe('opencode')
    expect(mockSpawn.mock.calls[0][2].env.HOME).toBe('/tmp/arche/.runtime/opencode-v2')
    expect(instanceService.setRunningIfCurrentDesktopStart).toHaveBeenCalledWith('local', expect.any(Date), expect.any(String), 'opencode-v2')
  })

  it('fails config preparation as a typed error without leaving a running process', async () => {
    const { build } = await prepareLegacyVault()
    build.mockRejectedValue(new Error('runtime_config_unsupported'))
    const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
    await expect(desktopWorkspaceHost.start('local', 'user-1')).resolves.toEqual({
      ok: false, error: 'start_failed', detail: 'runtime_config_unsupported',
    })
    const { instanceService } = await import('@/lib/services')
    expect(instanceService.setErrorIfCurrentDesktopStart).toHaveBeenCalledWith('local', expect.any(Date))
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('blocks the start when the archive helper cannot confirm cleanup', async () => {
    await prepareLegacyVault()
    mockArchiveDesktopLegacySessions.mockRejectedValue(new Error('desktop_legacy_archive_cleanup_unconfirmed'))
    const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
    await expect(desktopWorkspaceHost.start('local', 'user-1')).resolves.toEqual({
      ok: false, error: 'start_failed', detail: 'desktop_legacy_archive_cleanup_unconfirmed',
    })
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('keeps starts fenced while a prior archive helper is still alive', async () => {
    mockCleanupDesktopLegacyArchive.mockRejectedValueOnce(new Error('desktop_legacy_archive_cleanup_unconfirmed'))
    const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
    await expect(desktopWorkspaceHost.start('local', 'user-1')).resolves.toEqual({
      ok: false, error: 'start_failed', detail: 'desktop_legacy_archive_cleanup_unconfirmed',
    })
    expect(mockSpawn).not.toHaveBeenCalled()
    expect(mockWriteFileSync).not.toHaveBeenCalled()
    const { instanceService } = await import('@/lib/services')
    expect(instanceService.upsertStarting).not.toHaveBeenCalled()
  })

  it('never publishes running when provider synchronization fails', async () => {
    await prepareLegacyVault()
    process.env.ARCHE_DESKTOP_START_TIMEOUT_MS = '1'
    mockSpawn.mockReturnValueOnce(makeChildProcess({ exitCode: 0 })).mockReturnValueOnce(makeChildProcess({ exitCode: 0 }))
    const { syncRuntimeProviderAccess } = await import('@/lib/harness/registry')
    vi.mocked(syncRuntimeProviderAccess).mockResolvedValue({ ok: false, error: { code: 'runtime_error' } })
    const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
    await expect(desktopWorkspaceHost.start('local', 'user-1')).resolves.toMatchObject({ ok: false, error: 'start_failed' })
    const { instanceService } = await import('@/lib/services')
    expect(instanceService.setRunningIfCurrentDesktopStart).not.toHaveBeenCalled()
  })

  it('coalesces concurrent starts and refuses stop until archive preparation finishes', async () => {
    await prepareLegacyVault()
    let finish!: (result: { ok: true; data: { archived: number } }) => void
    mockArchiveDesktopLegacySessions.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    mockSpawn.mockReturnValueOnce(makeChildProcess()).mockReturnValueOnce(makeChildProcess())
    const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
    const first = desktopWorkspaceHost.start('local', 'user-1')
    const second = desktopWorkspaceHost.start('local', 'user-1')
    await vi.waitFor(() => expect(mockArchiveDesktopLegacySessions).toHaveBeenCalledTimes(1))
    expect(await desktopWorkspaceHost.stop('local', 'user-1')).toEqual({ ok: false, error: 'stop_failed' })
    finish({ ok: true, data: { archived: 2 } })
    expect(await first).toEqual(await second)
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('spawns opencode with serve command and workspace-agent with loopback addr', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      'opencode',
      ['serve', '--hostname', '127.0.0.1', '--port', expect.any(String)],
      expect.objectContaining({ stdio: 'pipe', detached: false }),
    )

    const workspaceAgentCall = mockSpawn.mock.calls[1]
    expect(workspaceAgentCall[0]).toBe('/mock/bin/workspace-agent')
    expect(workspaceAgentCall[1]).toEqual(['--addr', expect.stringMatching(/^127\.0\.0\.1:\d+$/)])
    expect(workspaceAgentCall[2]).toEqual(
      expect.objectContaining({
        stdio: 'pipe',
        detached: false,
        env: expect.objectContaining({
          WORKSPACE_AGENT_ADDR: expect.stringMatching(/^127\.0\.0\.1:\d+$/),
          WORKSPACE_AGENT_PORT: expect.stringMatching(/^\d+$/),
          KB_CONTENT_DIR: '/tmp/arche/kb-content',
        }),
      }),
    )
  })

  it('passes NODE_ENV through to both child process environments', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)
    process.env.NODE_ENV = 'production'

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      'opencode',
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ NODE_ENV: 'production' }) }),
    )
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      '/mock/bin/workspace-agent',
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ NODE_ENV: 'production' }) }),
    )
  })

  it('registers bundled Arche tools as local MCP without the plugin config directory', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)
    process.env.ARCHE_TOOLS_DIR = '/bundle/arche-tools'
    process.env.ARCHE_NODE_BIN = '/bundle/node'

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      'opencode',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          WORKSPACE_DIR: '/tmp/arche/workspace',
        }),
      }),
    )
    expect(mockSpawn.mock.calls[0][2].env).not.toHaveProperty('OPENCODE_CONFIG_DIR')
    const configCall = mockWriteFileSync.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && String(call[0]).endsWith('/opencode.json'),
    )
    expect(JSON.parse(String(configCall?.[1]))).toMatchObject({
      mcp: {
        servers: {
          arche_tools: {
            type: 'local',
            command: ['/bundle/node', '/bundle/arche-tools/server.js'],
            disabled: false,
            codemode: false,
          },
        },
      },
    })
  })

  it('writes AGENTS.md runtime instructions when available', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    mockReadFile.mockImplementation((target: string) => {
      if (target.endsWith('/CommonWorkspaceConfig.json')) {
        return Promise.resolve(
          JSON.stringify({
            $schema: 'https://opencode.ai/config.json',
            default_agent: 'assistant',
            agent: {
              assistant: {
                mode: 'primary',
                tools: { task: true },
              },
            },
          })
        )
      }

      if (target.endsWith('/AGENTS.md')) {
        return Promise.resolve('# AGENTS\n\nUse these guardrails.')
      }

      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      return Promise.reject(error)
    })

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('AGENTS.md'),
      expect.stringContaining('## Workspace User Identity'),
      'utf-8',
    )
  })

  it('materializes runtime skills into the workspace OpenCode skills directory', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { readSkillBundlesFromRepoDir } = await import('@/lib/skills/skill-store')
    vi.mocked(readSkillBundlesFromRepoDir).mockResolvedValue([
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

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/arche/workspace/.opencode/skills/pdf-processing/SKILL.md',
      expect.any(Buffer)
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/arche/workspace/.opencode/skills/arche-flow-authoring/SKILL.md',
      expect.any(Buffer)
    )
  })

  it('writes desktop provider gateway config with the IPv4 loopback host', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('opencode.json'),
      expect.stringContaining('http://127.0.0.1:3000/api/internal/providers/openai'),
      'utf-8',
    )
  })

  it('uses the resolved desktop web port for provider gateway config', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)
    process.env.ARCHE_DESKTOP_WEB_PORT = '4312'

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('opencode.json'),
      expect.stringContaining('http://127.0.0.1:4312/api/internal/providers/openai'),
      'utf-8',
    )
  })

  it('applies runtime config transforms and workspace permission guards', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    mockReadFile.mockImplementation((target: string) => {
      if (target.endsWith('/CommonWorkspaceConfig.json')) {
        return Promise.resolve(
          JSON.stringify({
            $schema: 'https://opencode.ai/config.json',
            default_agent: 'assistant',
            agent: {
              assistant: {
                mode: 'primary',
                tools: { task: true },
              },
              linear: {
                mode: 'subagent',
                prompt: 'Handle Linear.',
                tools: { task: true, 'arche_*': false, 'arche_linear_admin111_*': true },
              },
            },
          })
        )
      }

      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      return Promise.reject(error)
    })

    const { buildMcpConfigForSlug } = await import('@/lib/spawner/mcp-config')
    vi.mocked(buildMcpConfigForSlug).mockResolvedValue({
      connectorAliases: {},
      connectorDisplayNames: {},
      connectorToolPermissions: {},
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
    })

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const configCall = mockWriteFileSync.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && String(call[0]).endsWith('/opencode.json'),
    )
    type Rule = { action: string; resource: string; effect: string }
    const runtimeConfig = JSON.parse(String(configCall?.[1])) as {
      agents?: Record<string, { permissions?: Rule[]; steps?: number; system?: string }>
      mcp?: { servers?: Record<string, unknown> }
      policies?: Rule[]
      providers?: Record<string, { settings?: { baseURL?: string } }>
    }
    const glob = (pattern: string, value: string) =>
      new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(value)
    // OpenCode 2 evaluates permission rules last-match-wins.
    const decision = (rules: Rule[] | undefined, action: string, resource = '*') =>
      (rules ?? []).filter((rule) => glob(rule.action, action) && glob(rule.resource, resource)).at(-1)?.effect
    const assistant = runtimeConfig.agents?.assistant?.permissions
    const linear = runtimeConfig.agents?.linear?.permissions

    expect(runtimeConfig.providers?.openai?.settings?.baseURL).toBe(
      'http://127.0.0.1:3000/api/internal/providers/openai',
    )
    expect(runtimeConfig.providers?.fireworks?.settings?.baseURL).toBe(
      'http://127.0.0.1:3000/api/internal/providers/fireworks',
    )
    expect(runtimeConfig.providers?.['fireworks-ai']?.settings?.baseURL).toBe(
      'http://127.0.0.1:3000/api/internal/providers/fireworks',
    )
    expect(decision(runtimeConfig.policies, 'tool.use', 'edit:opencode.json')).toBe('deny')
    expect(decision(runtimeConfig.policies, 'tool.use', 'shell:npm install*')).toBe('deny')
    expect(runtimeConfig.mcp?.servers?.arche_linear_user999).toBeDefined()
    expect(decision(assistant, 'arche_tools_email_draft')).toBe('allow')
    expect(decision(assistant, 'arche_tools_flow_propose')).toBe('allow')
    expect(decision(assistant, 'skill', 'arche-flow-authoring')).toBe('allow')
    expect(decision(linear, 'arche_linear_user999_list')).toBe('allow')
    expect(decision(linear, 'arche_linear_admin111_list')).toBe('deny')
    expect(decision(linear, 'skill', 'arche-flow-authoring')).toBe('allow')
    expect(decision(linear, 'subagent', 'assistant')).toBe('deny')
    expect(decision(linear, 'doom_loop')).toBe('deny')
    expect(runtimeConfig.agents?.linear?.steps).toBe(40)
    expect(runtimeConfig.agents?.linear?.system).not.toContain('## Delegation constraint')
  })

  it('returns already_running when workspace is already started', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const result = await desktopWorkspaceHost.start('local', 'user-1')
    expect(result).toEqual({ ok: true, status: 'already_running' })
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('continues without workspace-agent when the binary is unavailable', async () => {
    const opencodeChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild)
    delete process.env.ARCHE_WORKSPACE_AGENT_BIN
    mockExistsSync.mockReturnValue(false)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result).toEqual({ ok: true, status: 'started' })
    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(await desktopWorkspaceHost.getAgentConnection('local')).toBeNull()
  })

  it('stops both managed processes for a running workspace', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const stopPromise = desktopWorkspaceHost.stop('local', 'user-1')
    opencodeChild.emit('exit', 0, 'SIGTERM')
    workspaceAgentChild.emit('exit', 0, 'SIGTERM')
    const result = await stopPromise

    expect(result).toEqual({ ok: true, status: 'stopped' })
    expect(opencodeChild.kill).toHaveBeenCalledWith('SIGTERM')
    expect(workspaceAgentChild.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('marks startup as failed when workspace-agent readiness never succeeds', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/global/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ healthy: true }),
        })
      }

      return Promise.reject(new Error('agent unavailable'))
    })
    process.env.ARCHE_DESKTOP_START_TIMEOUT_MS = '5'
    process.env.ARCHE_DESKTOP_START_INTERVAL_MS = '1'

    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') {
        fn()
      }
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    try {
      const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
      const result = await desktopWorkspaceHost.start('local', 'user-1')

      expect(result).toEqual({
        ok: false,
        error: 'start_failed',
        detail: 'workspace_agent_healthcheck_timeout',
      })

      const { instanceService } = await import('@/lib/services')
      expect(instanceService.setError).toHaveBeenCalledWith('local')
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('returns running status with startedAt after both processes start', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const status = await desktopWorkspaceHost.getStatus('local')
    expect(status).not.toBeNull()
    expect(status!.status).toBe('running')
    expect(status!.startedAt).toBeInstanceOf(Date)
    expect(status!.stoppedAt).toBeNull()
  })

  it('returns stopped status when no runtime exists', async () => {
    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const status = await desktopWorkspaceHost.getStatus('local')
    expect(status).toEqual({
      status: 'stopped',
      startedAt: null,
      stoppedAt: null,
      lastActivityAt: null,
    })
  })

  it('reconciles an orphaned starting record instead of blocking the next startup indefinitely', async () => {
    const { instanceService } = await import('@/lib/services')
    const snapshot = {
      status: 'starting' as const, startedAt: new Date(1), stoppedAt: null, lastActivityAt: null,
      containerId: null, serverPassword: 'enc:pw', runtimeKind: 'opencode-v1',
      providerSyncHash: null, providerSyncedAt: null,
    }
    vi.mocked(instanceService.findStatusBySlug).mockResolvedValue(snapshot)
    const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
    await expect(desktopWorkspaceHost.getStatus('local')).resolves.toMatchObject({ status: 'stopped' })
    expect(instanceService.setStoppedIfCurrentSnapshot).toHaveBeenCalledWith('local', snapshot)
  })

  it('can retry cleanup after an unconfirmed shutdown and recover once the process exits', async () => {
    vi.useFakeTimers()
    try {
      const opencodeChild = makeChildProcess()
      const workspaceAgentChild = makeChildProcess({ exitCode: 0 })
      vi.mocked(opencodeChild.kill).mockReturnValue(true)
      mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)
      const { desktopWorkspaceHost } = await import('@/lib/runtime/workspace-host-desktop')
      await desktopWorkspaceHost.start('local', 'user-1')
      const first = desktopWorkspaceHost.stop('local', 'user-1')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await first).toEqual({ ok: false, error: 'stop_failed' })

      Object.defineProperty(opencodeChild, 'exitCode', { value: 0 })
      await expect(desktopWorkspaceHost.stop('local', 'user-1')).resolves.toEqual({ ok: true, status: 'stopped' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rebuilds running status from persisted desktop instance state when the in-memory runtime is missing', async () => {
    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.findStatusBySlug).mockResolvedValue({
      status: 'running',
      startedAt: new Date('2026-03-22T18:00:00.000Z'),
      stoppedAt: null,
      lastActivityAt: new Date('2026-03-22T18:05:00.000Z'),
      containerId: null,
      serverPassword: 'enc:persisted-password',
    })
    process.env.ARCHE_DESKTOP_OPENCODE_PORT = '4096'

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const status = await desktopWorkspaceHost.getStatus('local')

    expect(status).toEqual({
      status: 'running',
      startedAt: new Date('2026-03-22T18:00:00.000Z'),
      stoppedAt: null,
      lastActivityAt: new Date('2026-03-22T18:05:00.000Z'),
    })
  })

  it('returns connection info for running workspace', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const conn = await desktopWorkspaceHost.getConnection('local')
    expect(conn).not.toBeNull()
    expect(conn!.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(conn!.authHeader).toMatch(/^Basic /)
  })

  it('returns agent connection info for running workspace', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const conn = await desktopWorkspaceHost.getAgentConnection('local')
    expect(conn).not.toBeNull()
    expect(conn!.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('resolves the agent from the stored instance when this module copy did not start the runtime', async () => {
    const connection = { baseUrl: 'http://127.0.0.1:4097', authHeader: 'Basic stored' }
    mockCreateWorkspaceAgentClient.mockResolvedValue(connection)
    process.env.ARCHE_DESKTOP_WORKSPACE_AGENT_PORT = '4097'

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')

    expect(await desktopWorkspaceHost.getAgentConnection('local')).toEqual(connection)
    expect(mockCreateWorkspaceAgentClient).toHaveBeenCalledWith('local')
  })

  it('returns null connections for stopped workspace', async () => {
    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    expect(await desktopWorkspaceHost.getConnection('local')).toBeNull()
    expect(await desktopWorkspaceHost.getAgentConnection('local')).toBeNull()
  })

  it('uses the generated password in auth headers by default', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const conn = await desktopWorkspaceHost.getConnection('local')
    const decoded = Buffer.from(conn!.authHeader.replace('Basic ', ''), 'base64').toString()
    expect(decoded).toBe('opencode:gen-pw')
  })

  it('syncs providers after both readiness checks pass for the workspace owner', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const { checkRuntimeHealth, syncRuntimeProviderAccess } = await import('@/lib/harness/registry')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(syncRuntimeProviderAccess).toHaveBeenCalledWith('local', {
      connection: {
        baseUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
        authHeader: expect.stringMatching(/^Basic /),
      },
      userId: 'local',
    })
    expect(checkRuntimeHealth).toHaveBeenCalledWith('local', {
      baseUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      password: 'gen-pw',
      timeoutMs: 3_000,
    })
  })

  it('retries provider sync before marking restart as required', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)
    process.env.ARCHE_DESKTOP_START_INTERVAL_MS = '1'
    process.env.ARCHE_DESKTOP_START_TIMEOUT_MS = '20'

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const { syncRuntimeProviderAccess } = await import('@/lib/harness/registry')
    const { providerService } = await import('@/lib/services')

    vi.mocked(syncRuntimeProviderAccess)
      .mockResolvedValueOnce({ ok: false, error: { code: 'sync_failed' } })
      .mockResolvedValueOnce({ ok: true, data: undefined })

    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result).toEqual({ ok: true, status: 'started' })
    expect(syncRuntimeProviderAccess).toHaveBeenCalledTimes(2)
    expect(providerService.clearWorkspaceRestartRequired).toHaveBeenCalledWith('local')
    expect(providerService.markWorkspaceRestartRequired).not.toHaveBeenCalled()
  })

  it('marks restart required and fails the start when provider sync retries are exhausted', async () => {
    const opencodeChild = makeChildProcess({ exitCode: 0 })
    const workspaceAgentChild = makeChildProcess({ exitCode: 0 })
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)
    process.env.ARCHE_DESKTOP_START_INTERVAL_MS = '1'
    process.env.ARCHE_DESKTOP_START_TIMEOUT_MS = '5'

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const { syncRuntimeProviderAccess } = await import('@/lib/harness/registry')
    const { providerService } = await import('@/lib/services')

    const syncMock = vi.mocked(syncRuntimeProviderAccess)
    syncMock.mockResolvedValue({ ok: false, error: { code: 'sync_failed' } })

    try {
      const result = await desktopWorkspaceHost.start('local', 'user-1')

      expect(result).toEqual({ ok: false, error: 'start_failed', detail: 'sync_failed' })
      expect(syncMock.mock.calls.length).toBeGreaterThanOrEqual(1)
      expect(providerService.markWorkspaceRestartRequired).toHaveBeenCalledWith('local')
      expect(providerService.clearWorkspaceRestartRequired).not.toHaveBeenCalled()
    } finally {
      // Reset to the default resolved value so subsequent tests are not
      // affected by the persistent failure mock (beforeEach uses
      // clearAllMocks which does not restore mock implementations).
      syncMock.mockResolvedValue({ ok: true, data: undefined })
    }
  })

  it('stores encrypted credentials in DB on start', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result).toEqual({ ok: true, status: 'started' })

    const { instanceService } = await import('@/lib/services')
    expect(instanceService.upsertStarting).toHaveBeenCalledWith('local', 'enc:gen-pw', expect.any(Date))
  })

  it('stopManagedProcess waits for actual exit, not just killed flag', async () => {
    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    const stopPromise = desktopWorkspaceHost.stop('local', 'user-1')

    // After kill(), child.killed is true but exitCode is still null.
    // stop must NOT have resolved yet — it should be waiting for exit.
    expect(opencodeChild.killed).toBe(true)

    // Simulate the process actually exiting after a delay
    opencodeChild.emit('exit', 0, 'SIGTERM')
    workspaceAgentChild.emit('exit', 0, 'SIGTERM')

    const result = await stopPromise
    expect(result).toEqual({ ok: true, status: 'stopped' })
  })

  it('exposes detailed start failures in its return type', async () => {
    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    expect(desktopWorkspaceHost).toBeDefined()

    expectTypeOf<Awaited<ReturnType<typeof desktopWorkspaceHost.start>>>().toEqualTypeOf<
      | { ok: true; status: string }
      | { ok: false; error: string; detail?: string }
    >()
  })
})

describe('binary resolution', () => {
  const originalEnv = process.env
  const originalResourcesPath = process.resourcesPath

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.ARCHE_OPENCODE_BIN
    delete process.env.ARCHE_OPENCODE_V1_BIN
    delete process.env.ARCHE_WORKSPACE_AGENT_BIN
    // @ts-expect-error test isolation
    process.resourcesPath = undefined
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error test isolation
    process.resourcesPath = originalResourcesPath
  })

  it('returns ARCHE_OPENCODE_BIN when set', async () => {
    process.env.ARCHE_OPENCODE_BIN = '/custom/path/opencode'

    const { getOpencodeBinary } = await import('../workspace-host-desktop')
    expect(getOpencodeBinary()).toBe('/custom/path/opencode')
  })

  it('returns ARCHE_WORKSPACE_AGENT_BIN when set', async () => {
    process.env.ARCHE_WORKSPACE_AGENT_BIN = '/custom/path/workspace-agent'

    const { getWorkspaceAgentBinary } = await import('../workspace-host-desktop')
    expect(getWorkspaceAgentBinary()).toBe('/custom/path/workspace-agent')
  })

  it('returns bundled binary paths when packaged resources exist', async () => {
    // @ts-expect-error simulating Electron packaged environment
    process.resourcesPath = '/Applications/Arche.app/Contents/Resources'
    mockExistsSync.mockReturnValue(true)

    const { getOpencodeBinary, getWorkspaceAgentBinary } = await import('../workspace-host-desktop')
    expect(getOpencodeBinary()).toBe('/Applications/Arche.app/Contents/Resources/bin/opencode')
    expect(getWorkspaceAgentBinary()).toBe('/Applications/Arche.app/Contents/Resources/bin/workspace-agent')
  })

  it('falls back to PATH lookup when bundled binaries are unavailable', async () => {
    const { getOpencodeBinary, getWorkspaceAgentBinary } = await import('../workspace-host-desktop')
    expect(getOpencodeBinary()).toBe('opencode')
    expect(getWorkspaceAgentBinary()).toBe('workspace-agent')
  })

  it('returns start_failed when health check times out', async () => {
    process.env.ARCHE_DATA_DIR = '/tmp/arche'
    // Make health check always fail so it times out
    mockFetch.mockRejectedValue(new Error('connection refused'))
    const { checkRuntimeHealth } = await import('@/lib/harness/registry')
    vi.mocked(checkRuntimeHealth).mockResolvedValue({ ok: false, error: { code: 'unhealthy_response', detail: 'connection refused' } })

    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    // Use fast timeout so the test doesn't hang
    process.env.ARCHE_DESKTOP_START_TIMEOUT_MS = '100'
    process.env.ARCHE_DESKTOP_START_INTERVAL_MS = '10'

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    const result = await desktopWorkspaceHost.start('local', 'user-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('start_failed')
    }
  }, 10000)

  it('propagates git init errors on start', async () => {
    process.env.ARCHE_DATA_DIR = '/tmp/arche'
    // Make existsSync return false for .git so git init runs, then throw
    mockExistsSync.mockImplementation((target: string) => {
      if (target.endsWith('.git')) return false
      if (target === '/mock/bin/workspace-agent') return true
      return false
    })
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not found')
    })

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await expect(desktopWorkspaceHost.start('local', 'user-1')).rejects.toThrow('git not found')
  })

  it('concurrent stop calls on the same slug do not error', async () => {
    process.env.ARCHE_DATA_DIR = '/tmp/arche'
    // Restore mocks for this test
    mockExecFileSync.mockReturnValue('')
    mockExistsSync.mockImplementation((target: string) => target === '/mock/bin/workspace-agent')
    mockHealthyFetch()
    const { checkRuntimeHealth } = await import('@/lib/harness/registry')
    vi.mocked(checkRuntimeHealth).mockResolvedValue({ ok: true, data: {} })

    const opencodeChild = makeChildProcess()
    // Reset mockSpawn to clear any unconsumed mockReturnValueOnce from prior tests
    mockSpawn.mockReset()
    mockSpawn.mockReturnValueOnce(opencodeChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    // Fire two stops concurrently, then simulate processes exiting
    const p1 = desktopWorkspaceHost.stop('local')
    const p2 = desktopWorkspaceHost.stop('local')

    opencodeChild.emit('exit', 0, 'SIGTERM')

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })
})

describe('desktop instance reconciliation', () => {
  const originalEnv = process.env
  const originalResourcesPath = process.resourcesPath

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    process.env = { ...originalEnv }
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    process.env.ARCHE_DATA_DIR = '/tmp/arche'
    delete process.env.ARCHE_OPENCODE_BIN
    process.env.ARCHE_WORKSPACE_AGENT_BIN = '/mock/bin/workspace-agent'
    delete process.env.ARCHE_DESKTOP_WEB_PORT
    delete process.env.ARCHE_DESKTOP_START_TIMEOUT_MS
    delete process.env.ARCHE_DESKTOP_START_INTERVAL_MS
    delete process.env.OPENCODE_SERVER_PASSWORD
    // @ts-expect-error test isolation
    process.resourcesPath = undefined
    // @ts-expect-error test isolation
    globalThis.archeDesktopCleanupRegistered = undefined
    mockExistsSync.mockImplementation((target: string) => target === '/mock/bin/workspace-agent')
    mockRandomBytes.mockReturnValue({ toString: () => 'gen-pw' })
    mockHealthyFetch()
    const { checkRuntimeHealth } = await import('@/lib/harness/registry')
    vi.mocked(checkRuntimeHealth).mockResolvedValue({ ok: true, data: {} })
  })

  afterEach(() => {
    process.env = originalEnv
    // @ts-expect-error test isolation
    process.resourcesPath = originalResourcesPath
  })

  it('marks stale running instances as stopped on first start', async () => {
    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.findActiveInstances).mockResolvedValue([
      { slug: 'orphan-1', status: 'running', startedAt: new Date(), lastActivityAt: new Date() },
      { slug: 'orphan-2', status: 'starting', startedAt: new Date(), lastActivityAt: null },
    ])

    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    expect(instanceService.setStopped).toHaveBeenCalledWith('orphan-1')
    expect(instanceService.setStopped).toHaveBeenCalledWith('orphan-2')
  })

  it('only reconciles once across multiple start calls', async () => {
    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.findActiveInstances).mockResolvedValue([
      { slug: 'orphan', status: 'running', startedAt: new Date(), lastActivityAt: new Date() },
    ])

    const child1 = makeChildProcess()
    const agent1 = makeChildProcess()
    const child2 = makeChildProcess()
    const agent2 = makeChildProcess()
    mockSpawn.mockReturnValueOnce(child1).mockReturnValueOnce(agent1)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    // Stop the first workspace
    const stopPromise = desktopWorkspaceHost.stop('local')
    child1.emit('exit', 0, 'SIGTERM')
    agent1.emit('exit', 0, 'SIGTERM')
    await stopPromise

    // Start a second workspace — reconciliation should NOT run again
    vi.mocked(instanceService.findActiveInstances).mockClear()
    mockSpawn.mockReturnValueOnce(child2).mockReturnValueOnce(agent2)
    await desktopWorkspaceHost.start('local2', 'user-1')

    expect(instanceService.findActiveInstances).not.toHaveBeenCalled()
  })

  it('does not mark instances that have backing processes', async () => {
    const { instanceService } = await import('@/lib/services')
    vi.mocked(instanceService.findActiveInstances).mockResolvedValue([])

    const opencodeChild = makeChildProcess()
    const workspaceAgentChild = makeChildProcess()
    mockSpawn.mockReturnValueOnce(opencodeChild).mockReturnValueOnce(workspaceAgentChild)

    const { desktopWorkspaceHost } = await import('../workspace-host-desktop')
    await desktopWorkspaceHost.start('local', 'user-1')

    // setStopped should only have been called for reconciliation (none in this case),
    // not for the running workspace
    expect(instanceService.setStopped).not.toHaveBeenCalled()
  })
})

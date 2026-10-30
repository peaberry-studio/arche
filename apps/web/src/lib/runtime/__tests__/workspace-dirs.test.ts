import { createHash } from 'node:crypto'
import { win32 } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecFileSync = vi.fn()
const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()

vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}))

vi.mock('fs', () => ({
  realpathSync: (path: string) => path.replace(/\/\.\//g, '/').replace(/\/$/, ''),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}))

vi.mock('@/lib/runtime/paths', () => ({
  getKbContentRoot: vi.fn(() => '/tmp/arche/.kb-content'),
}))

describe('desktop workspace dirs', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = {
      ...originalEnv,
      ARCHE_DATA_DIR: '/tmp/arche',
      ARCHE_DESKTOP_PLATFORM: 'darwin',
      ARCHE_DESKTOP_WEB_HOST: '127.0.0.1',
      ARCHE_RUNTIME_MODE: 'desktop',
    }
    delete process.env.ARCHE_OPENCODE_DATA_DIR
  })

  afterEach(() => {
    process.env = originalEnv
    vi.doUnmock('os')
    vi.doUnmock('path')
    vi.doUnmock('@arche/desktop-runtime/layout')
  })

  it('keeps OpenCode 2 state apart from the legacy OpenCode 1 data directory', async () => {
    const { getArcheOpencodeDataDir, getLegacyOpencodeDataDir } = await import('@/lib/runtime/desktop/workspace-dirs')
    expect(getArcheOpencodeDataDir()).toBe('/tmp/arche/.runtime/opencode-v2')
    expect(getLegacyOpencodeDataDir()).toBe('/tmp/arche/.runtime/opencode')
  })

  it('uses the configured data root for legacy data and a distinct suffixed root for OpenCode 2', async () => {
    process.env.ARCHE_OPENCODE_DATA_DIR = '/custom/runtime'
    const { getArcheOpencodeDataDir, getLegacyOpencodeDataDir } = await import('@/lib/runtime/desktop/workspace-dirs')
    expect(getLegacyOpencodeDataDir()).toBe('/custom/runtime')
    expect(getArcheOpencodeDataDir()).toBe('/custom/runtime-v2')
  })

  it('keeps session scratch folders in the OS temp dir, outside the vault workspace', async () => {
    const { tmpdir } = await import('os')
    const { getDesktopScratch } = await import('@/lib/runtime/desktop/workspace-dirs')
    expect(getDesktopScratch('local')).toEqual({ root: expect.stringMatching(new RegExp(`^${tmpdir()}/arche-scratch/[a-f0-9]{64}$`)), workspaceRoot: '/tmp/arche/workspace' })
  })

  it.each(['C', 'D'])('normalizes Windows scratch and workspace roots on vault drive %s', async (drive) => {
    process.env.ARCHE_DATA_DIR = `${drive}:\\Users\\Ada\\Vault`
    process.env.ARCHE_DESKTOP_PLATFORM = 'win32'
    vi.doMock('os', () => ({ tmpdir: () => String.raw`C:\Users\Ada\AppData\Local\Temp` }))
    vi.doMock('path', () => win32)
    vi.doMock('@arche/desktop-runtime/layout', () => ({
      getDesktopRuntimeDataDir: (vault: string) => win32.join(vault, '.runtime', 'opencode'),
      getDesktopWorkspaceDir: (vault: string) => win32.join(vault, 'workspace'),
    }))
    const { getDesktopScratch } = await import('@/lib/runtime/desktop/workspace-dirs')
    const hash = createHash('sha256').update(process.env.ARCHE_DATA_DIR).digest('hex')

    expect(getDesktopScratch('local')).toEqual({
      root: `C:/Users/Ada/AppData/Local/Temp/arche-scratch/${hash}`,
      workspaceRoot: `${drive}:/Users/Ada/Vault/workspace`,
    })
    expect(getDesktopScratch('another-user')).toEqual(getDesktopScratch('local'))
  })

  it('derives the XDG data home and the tool-output directory from the OpenCode 2 data directory', async () => {
    const { getDesktopToolOutputDirectory, getDesktopXdgDataHome } = await import('@/lib/runtime/desktop/workspace-dirs')
    expect(getDesktopXdgDataHome()).toBe('/tmp/arche/.runtime/opencode-v2/.local/share')
    expect(getDesktopToolOutputDirectory()).toBe('/tmp/arche/.runtime/opencode-v2/.local/share/opencode/tool-output')
  })

  it('normalizes the Windows tool-output directory to forward slashes', async () => {
    process.env.ARCHE_DATA_DIR = String.raw`C:\Users\Ada\Vault`
    process.env.ARCHE_DESKTOP_PLATFORM = 'win32'
    vi.doMock('path', () => win32)
    vi.doMock('@arche/desktop-runtime/layout', () => ({
      getDesktopRuntimeDataDir: (vault: string) => win32.join(vault, '.runtime', 'opencode'),
      getDesktopWorkspaceDir: (vault: string) => win32.join(vault, 'workspace'),
    }))
    const { getDesktopToolOutputDirectory } = await import('@/lib/runtime/desktop/workspace-dirs')
    expect(getDesktopToolOutputDirectory()).toBe('C:/Users/Ada/Vault/.runtime/opencode-v2/.local/share/opencode/tool-output')
  })

  it('detects legacy OpenCode 1 data only when its share directory exists', async () => {
    const { hasLegacyOpencodeData } = await import('@/lib/runtime/desktop/workspace-dirs')
    mockExistsSync.mockImplementation((path: string) => path === '/tmp/arche/.runtime/opencode/.local/share/opencode')
    expect(hasLegacyOpencodeData()).toBe(true)
    mockExistsSync.mockImplementation(() => false)
    expect(hasLegacyOpencodeData()).toBe(false)
  })

  it('namespaces scratch by canonical vault path rather than user slug', async () => {
    const { getDesktopScratch } = await import('@/lib/runtime/desktop/workspace-dirs')
    const first = getDesktopScratch('local')
    expect(getDesktopScratch('another-user').root).toBe(first.root)
    process.env.ARCHE_DATA_DIR = '/tmp/./arche/'
    expect(getDesktopScratch('local').root).toBe(first.root)
    process.env.ARCHE_DATA_DIR = '/tmp/other-vault'
    expect(getDesktopScratch('local').root).not.toBe(first.root)
  })

  it('bootstraps the workspace repo only once and stays idempotent on repeated calls', async () => {
    const workspaceDir = '/tmp/arche/workspace'
    const gitDir = '/tmp/arche/workspace/.git'
    const excludePath = '/tmp/arche/workspace/.git/info/exclude'
    const existingPaths = new Set<string>(['/tmp/arche'])
    const fileContents = new Map<string, string>()
    let kbRemoteUrl: string | null = null

    mockExistsSync.mockImplementation((target: string) => existingPaths.has(target))
    mockMkdirSync.mockImplementation((target: string) => {
      existingPaths.add(target)
    })
    mockReadFileSync.mockImplementation((target: string) => fileContents.get(target) ?? '')
    mockWriteFileSync.mockImplementation((target: string, content: string) => {
      existingPaths.add(target)
      fileContents.set(target, content)
    })
    mockExecFileSync.mockImplementation((command: string, args: string[]) => {
      expect(command).toBe('git')

      if (args[0] === 'init') {
        existingPaths.add(gitDir)
        return ''
      }

      if (args[0] === 'commit') {
        return ''
      }

      if (args[0] === 'rev-parse') {
        return '.git/info/exclude'
      }

      if (args[0] === 'remote' && args[1] === 'get-url') {
        if (!kbRemoteUrl) {
          throw new Error('remote missing')
        }

        return kbRemoteUrl
      }

      if (args[0] === 'remote' && (args[1] === 'add' || args[1] === 'set-url')) {
        kbRemoteUrl = args[3] ?? null
        return ''
      }

      throw new Error(`Unexpected git command: ${args.join(' ')}`)
    })

    const { getWorkspaceDir } = await import('../desktop/workspace-dirs')

    expect(getWorkspaceDir('local')).toBe(workspaceDir)
    expect(getWorkspaceDir('local2')).toBe(workspaceDir)

    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['init', '-b', 'main', workspaceDir])
    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd: workspaceDir })
    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['remote', 'add', 'kb', '/tmp/arche/.kb-content'], { cwd: workspaceDir })

    const initCalls = mockExecFileSync.mock.calls.filter(([, args]) => args[0] === 'init')
    const commitCalls = mockExecFileSync.mock.calls.filter(([, args]) => args[0] === 'commit')
    const remoteAddCalls = mockExecFileSync.mock.calls.filter(([, args]) => args[0] === 'remote' && args[1] === 'add')
    const remoteSetUrlCalls = mockExecFileSync.mock.calls.filter(([, args]) => args[0] === 'remote' && args[1] === 'set-url')

    expect(initCalls).toHaveLength(1)
    expect(commitCalls).toHaveLength(1)
    expect(remoteAddCalls).toHaveLength(1)
    expect(remoteSetUrlCalls).toHaveLength(0)
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
    expect(fileContents.get(excludePath)).toBe('opencode.json\nAGENTS.md\nnode_modules/\n.opencode/skills/\n')
  })

  it('rejects invalid slugs before resolving the shared workspace path', async () => {
    const { getWorkspaceDir } = await import('../desktop/workspace-dirs')

    expect(() => getWorkspaceDir('../etc')).toThrow()
  })
})

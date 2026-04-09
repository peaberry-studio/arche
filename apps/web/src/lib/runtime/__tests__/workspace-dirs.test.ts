import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecFileSync = vi.fn()
const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()

vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}))

vi.mock('fs', () => ({
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
    expect(fileContents.get(excludePath)).toBe('opencode.json\nAGENTS.md\nnode_modules/\n')
  })

  it('rejects invalid slugs before resolving the shared workspace path', async () => {
    const { getWorkspaceDir } = await import('../desktop/workspace-dirs')

    expect(() => getWorkspaceDir('../etc')).toThrow()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = process.env
const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath

function setResourcesPath(value: string | undefined) {
  if (value === undefined) {
    delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    return
  }

  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value,
  })
}

function mockExistsSync(implementation: (path: string) => boolean) {
  const existsSync = vi.fn(implementation)
  vi.doMock('fs', () => ({ existsSync }))
  return existsSync
}

describe('desktop runtime config', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.ARCHE_NODE_BIN
    delete process.env.ARCHE_OPENCODE_BIN
    delete process.env.ARCHE_OPENCODE_V1_BIN
    delete process.env.ARCHE_TOOLS_DIR
    setResourcesPath(undefined)
  })

  afterEach(() => {
    process.env = originalEnv
    setResourcesPath(originalResourcesPath)
    vi.doUnmock('fs')
    vi.resetModules()
  })

  it('uses bundled Arche tools and Node from resourcesPath', async () => {
    setResourcesPath('/Applications/Arche.app/Contents/Resources')
    mockExistsSync((path) => path === '/Applications/Arche.app/Contents/Resources/bin/node')

    const { getDesktopArcheToolsCommand } = await import('@/lib/runtime/desktop/config')

    expect(getDesktopArcheToolsCommand()).toEqual([
      '/Applications/Arche.app/Contents/Resources/bin/node',
      '/Applications/Arche.app/Contents/Resources/bin/arche-tools/server.js',
    ])
  })

  it('selects the bundled current and legacy OpenCode binaries', async () => {
    setResourcesPath('/Applications/Arche.app/Contents/Resources')
    mockExistsSync(() => true)

    const { getLegacyOpencodeBinary, getOpencodeBinary } = await import('@/lib/runtime/desktop/config')

    expect(getOpencodeBinary()).toBe('/Applications/Arche.app/Contents/Resources/bin/opencode')
    expect(getLegacyOpencodeBinary()).toBe('/Applications/Arche.app/Contents/Resources/bin/opencode-v1')
  })

  it('uses separate explicit overrides for legacy and current OpenCode', async () => {
    process.env.ARCHE_OPENCODE_BIN = '/custom runtime/opencode'
    process.env.ARCHE_OPENCODE_V1_BIN = '/custom runtime/opencode-v1'
    mockExistsSync(() => true)

    const { getLegacyOpencodeBinary, getOpencodeBinary } = await import('@/lib/runtime/desktop/config')

    expect(getOpencodeBinary()).toBe('/custom runtime/opencode')
    expect(getLegacyOpencodeBinary()).toBe('/custom runtime/opencode-v1')
  })

  it('never falls back to the other runtime binary or its override', async () => {
    setResourcesPath('/Applications/Arche.app/Contents/Resources')
    const existsSync = mockExistsSync((path) => path.endsWith('/bin/opencode'))
    process.env.ARCHE_OPENCODE_BIN = '/custom/opencode'

    const { getLegacyOpencodeBinary, getOpencodeBinary } = await import('@/lib/runtime/desktop/config')

    expect(getLegacyOpencodeBinary()).toBe('opencode-v1')
    delete process.env.ARCHE_OPENCODE_BIN
    process.env.ARCHE_OPENCODE_V1_BIN = '/custom/opencode-v1'
    existsSync.mockImplementation((path) => path.endsWith('/bin/opencode-v1'))
    expect(getOpencodeBinary()).toBe('opencode')
  })

  it('uses distinct PATH binary names when no bundle or overrides exist', async () => {
    mockExistsSync(() => false)

    const { getLegacyOpencodeBinary, getOpencodeBinary } = await import('@/lib/runtime/desktop/config')

    expect(getOpencodeBinary()).toBe('opencode')
    expect(getLegacyOpencodeBinary()).toBe('opencode-v1')
  })

  it('falls back to repository Arche tools candidates and Node on PATH', async () => {
    const existsSync = mockExistsSync(() => false)
    existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true)

    const { getDesktopArcheToolsCommand } = await import('@/lib/runtime/desktop/config')

    expect(getDesktopArcheToolsCommand()).toEqual(['node', expect.stringContaining('infra/workspace-image/arche-tools/server.js')])
    expect(existsSync).toHaveBeenCalledTimes(2)
  })

  it('uses explicit tools and Node overrides as separate command arguments', async () => {
    process.env.ARCHE_NODE_BIN = '/custom runtime/node'
    process.env.ARCHE_TOOLS_DIR = '/custom runtime/arche-tools'
    mockExistsSync(() => false)

    const { getDesktopArcheToolsCommand } = await import('@/lib/runtime/desktop/config')

    expect(getDesktopArcheToolsCommand()).toEqual([
      '/custom runtime/node',
      '/custom runtime/arche-tools/server.js',
    ])
  })

  it('detects workspace-agent on PATH when no bundled binary exists', async () => {
    process.env.PATH = ':/opt/arche/bin'
    mockExistsSync((path) => path === '/opt/arche/bin/workspace-agent')

    const { canSpawnWorkspaceAgent } = await import('@/lib/runtime/desktop/config')

    expect(canSpawnWorkspaceAgent()).toBe(true)
  })

  it('returns false when workspace-agent is not configured or discoverable', async () => {
    delete process.env.PATH
    mockExistsSync(() => false)

    const { canSpawnWorkspaceAgent } = await import('@/lib/runtime/desktop/config')

    expect(canSpawnWorkspaceAgent()).toBe(false)
  })
})

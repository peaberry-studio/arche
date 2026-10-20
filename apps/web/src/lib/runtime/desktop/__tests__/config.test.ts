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
    vi.doUnmock('@/lib/spawner/runtime-artifacts')
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

  it('defaults to the legacy binary and selects bundled OpenCode by runtime kind', async () => {
    setResourcesPath('/Applications/Arche.app/Contents/Resources')
    mockExistsSync(() => true)

    const { getOpencodeBinary } = await import('@/lib/runtime/desktop/config')

    expect(getOpencodeBinary()).toBe('/Applications/Arche.app/Contents/Resources/bin/opencode-v1')
    expect(getOpencodeBinary('opencode-v1')).toBe('/Applications/Arche.app/Contents/Resources/bin/opencode-v1')
    expect(getOpencodeBinary('opencode-v2')).toBe('/Applications/Arche.app/Contents/Resources/bin/opencode')
  })

  it('uses separate explicit overrides for legacy and current OpenCode', async () => {
    process.env.ARCHE_OPENCODE_BIN = '/custom runtime/opencode'
    process.env.ARCHE_OPENCODE_V1_BIN = '/custom runtime/opencode-v1'
    mockExistsSync(() => true)

    const { getOpencodeBinary } = await import('@/lib/runtime/desktop/config')

    expect(getOpencodeBinary()).toBe('/custom runtime/opencode-v1')
    expect(getOpencodeBinary('opencode-v2')).toBe('/custom runtime/opencode')
  })

  it('never falls back to the other runtime binary or its override', async () => {
    setResourcesPath('/Applications/Arche.app/Contents/Resources')
    const existsSync = mockExistsSync((path) => path.endsWith('/bin/opencode'))
    process.env.ARCHE_OPENCODE_BIN = '/custom/opencode'

    const { getOpencodeBinary } = await import('@/lib/runtime/desktop/config')

    expect(getOpencodeBinary()).toBe('opencode-v1')
    delete process.env.ARCHE_OPENCODE_BIN
    process.env.ARCHE_OPENCODE_V1_BIN = '/custom/opencode-v1'
    existsSync.mockImplementation((path) => path.endsWith('/bin/opencode-v1'))
    expect(getOpencodeBinary('opencode-v2')).toBe('opencode')
  })

  it('uses distinct PATH binary names when no bundle or overrides exist', async () => {
    mockExistsSync(() => false)

    const { getOpencodeBinary } = await import('@/lib/runtime/desktop/config')

    expect(getOpencodeBinary()).toBe('opencode-v1')
    expect(getOpencodeBinary('opencode-v2')).toBe('opencode')
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

  it('builds desktop opencode config with the desktop provider gateway', async () => {
    const buildWorkspaceRuntimeConfig = vi.fn((slug: string, providerConfig: Record<string, unknown>) => ({
      providerConfig,
      slug,
    }))
    vi.doMock('@/lib/spawner/runtime-artifacts', () => ({ buildWorkspaceRuntimeConfig }))
    process.env.ARCHE_DESKTOP_WEB_PORT = '4123'
    process.env.ARCHE_TOOLS_DIR = '/bundle/arche-tools'
    process.env.ARCHE_NODE_BIN = '/bundle/node'

    const { buildDesktopOpencodeConfig } = await import('@/lib/runtime/desktop/config')

    await expect(buildDesktopOpencodeConfig('alice')).resolves.toMatchObject({ slug: 'alice' })
    expect(buildWorkspaceRuntimeConfig).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ provider: expect.any(Object) }),
      undefined,
      undefined,
      { archeToolsCommand: ['/bundle/node', '/bundle/arche-tools/server.js'] },
    )
    expect(JSON.stringify(buildWorkspaceRuntimeConfig.mock.calls[0]?.[1])).toContain('127.0.0.1:4123')
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

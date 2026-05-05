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
    setResourcesPath(undefined)
  })

  afterEach(() => {
    process.env = originalEnv
    setResourcesPath(originalResourcesPath)
    vi.doUnmock('fs')
    vi.doUnmock('@/lib/spawner/runtime-artifacts')
    vi.resetModules()
  })

  it('uses a bundled opencode config directory from resourcesPath', async () => {
    setResourcesPath('/Applications/Arche.app/Contents/Resources')
    mockExistsSync((path) => path === '/Applications/Arche.app/Contents/Resources/opencode-config')

    const { getDesktopOpencodeConfigDir } = await import('@/lib/runtime/desktop/config')

    expect(getDesktopOpencodeConfigDir()).toBe('/Applications/Arche.app/Contents/Resources/opencode-config')
  })

  it('falls back to repository opencode config candidates', async () => {
    const existsSync = mockExistsSync(() => false)
    existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true)

    const { getDesktopOpencodeConfigDir } = await import('@/lib/runtime/desktop/config')

    expect(getDesktopOpencodeConfigDir()).toContain('infra/workspace-image/opencode-config')
    expect(existsSync).toHaveBeenCalledTimes(2)
  })

  it('builds desktop opencode config with the desktop provider gateway', async () => {
    const buildWorkspaceRuntimeConfig = vi.fn((slug: string, providerConfig: Record<string, unknown>) => ({
      providerConfig,
      slug,
    }))
    vi.doMock('@/lib/spawner/runtime-artifacts', () => ({ buildWorkspaceRuntimeConfig }))
    process.env.ARCHE_DESKTOP_WEB_PORT = '4123'

    const { buildDesktopOpencodeConfig } = await import('@/lib/runtime/desktop/config')

    await expect(buildDesktopOpencodeConfig('alice')).resolves.toMatchObject({ slug: 'alice' })
    expect(buildWorkspaceRuntimeConfig).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ provider: expect.any(Object) }),
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

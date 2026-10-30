import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readFileSync: vi.fn() }))
vi.mock('node:fs', () => ({ readFileSync: mocks.readFileSync }))

describe('build server action manifest', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('recognizes current actions and detects removed actions using the packaged manifest', async () => {
    mocks.readFileSync.mockReturnValue(JSON.stringify({ node: { current: {} }, edge: { edgeAction: {} }, encryptionKey: 'fixture' }))
    const { isKnownServerAction } = await import('@/lib/server-action-manifest')
    expect(isKnownServerAction('current')).toBe(true)
    expect(isKnownServerAction('edgeAction')).toBe(true)
    expect(isKnownServerAction('removed')).toBe(false)
    expect(mocks.readFileSync).toHaveBeenCalledOnce()
  })

  it('uses the configured desktop build directory', async () => {
    vi.stubEnv('ARCHE_DESKTOP_NEXT_DIST_DIR', '/tmp/desktop-build')
    mocks.readFileSync.mockReturnValue(JSON.stringify({ node: {}, edge: {} }))
    const { isKnownServerAction } = await import('@/lib/server-action-manifest')
    expect(isKnownServerAction('removed')).toBe(false)
    expect(mocks.readFileSync).toHaveBeenCalledWith('/tmp/desktop-build/server/server-reference-manifest.json', 'utf8')
  })

  it('leaves framework handling intact and reports an unavailable manifest', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.readFileSync.mockImplementation(() => { throw new Error('ENOENT') })
    const { isKnownServerAction } = await import('@/lib/server-action-manifest')
    expect(isKnownServerAction('anything')).toBeNull()
    expect(isKnownServerAction('another')).toBeNull()
    expect(warning).toHaveBeenCalledOnce()
    expect(mocks.readFileSync).toHaveBeenCalledOnce()
  })
})

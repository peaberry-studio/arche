import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('requireCapability', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns null when capability is enabled (web mode)', async () => {
    delete process.env.ARCHE_RUNTIME_MODE
    const { requireCapability } = await import('../require-capability')

    expect(requireCapability('teamManagement')).toBeNull()
    expect(requireCapability('connectors')).toBeNull()
    expect(requireCapability('twoFactor')).toBeNull()
  })

  it('returns 403 when capability is disabled (desktop mode)', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    const { requireCapability } = await import('../require-capability')

    const res = requireCapability('teamManagement')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    const body = await res!.json()
    expect(body.error).toContain('teamManagement')
  })

  it('returns null for capabilities enabled in desktop mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    const { requireCapability } = await import('../require-capability')

    expect(requireCapability('workspaceAgent')).toBeNull()
    expect(requireCapability('kickstart')).toBeNull()
  })

  it('blocks connectors in desktop mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'linux'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    const { requireCapability } = await import('../require-capability')

    const res = requireCapability('connectors')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('blocks twoFactor in desktop mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    const { requireCapability } = await import('../require-capability')

    const res = requireCapability('twoFactor')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })
})

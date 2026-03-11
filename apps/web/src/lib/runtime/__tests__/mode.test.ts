import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('runtime mode', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('defaults to web when ARCHE_RUNTIME_MODE is not set', async () => {
    delete process.env.ARCHE_RUNTIME_MODE
    const { getRuntimeMode } = await import('../mode')
    expect(getRuntimeMode()).toBe('web')
  })

  it('returns web when ARCHE_RUNTIME_MODE is "web"', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'web'
    const { getRuntimeMode } = await import('../mode')
    expect(getRuntimeMode()).toBe('web')
  })

  it('returns desktop when ARCHE_RUNTIME_MODE is "desktop"', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    const { getRuntimeMode } = await import('../mode')
    expect(getRuntimeMode()).toBe('desktop')
  })

  it('trims and lowercases the env var', async () => {
    process.env.ARCHE_RUNTIME_MODE = '  Desktop  '
    const { getRuntimeMode } = await import('../mode')
    expect(getRuntimeMode()).toBe('desktop')
  })

  it('falls back to web for unknown values', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'mobile'
    const { getRuntimeMode } = await import('../mode')
    expect(getRuntimeMode()).toBe('web')
  })

  it('isWeb returns true in web mode', async () => {
    delete process.env.ARCHE_RUNTIME_MODE
    const { isWeb, isDesktop } = await import('../mode')
    expect(isWeb()).toBe(true)
    expect(isDesktop()).toBe(false)
  })

  it('isDesktop returns true in desktop mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    const { isWeb, isDesktop } = await import('../mode')
    expect(isDesktop()).toBe(true)
    expect(isWeb()).toBe(false)
  })

  it('caches the resolved mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    const { getRuntimeMode } = await import('../mode')
    expect(getRuntimeMode()).toBe('desktop')

    // Change the env var after caching
    process.env.ARCHE_RUNTIME_MODE = 'web'
    expect(getRuntimeMode()).toBe('desktop') // still cached
  })
})

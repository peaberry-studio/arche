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

  it('returns desktop when ARCHE_RUNTIME_MODE is "desktop" with valid env', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    const { getRuntimeMode } = await import('../mode')
    expect(getRuntimeMode()).toBe('desktop')
  })

  it('trims and lowercases the env var', async () => {
    process.env.ARCHE_RUNTIME_MODE = '  Desktop  '
    process.env.ARCHE_DESKTOP_PLATFORM = 'linux'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
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
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    const { isWeb, isDesktop } = await import('../mode')
    expect(isDesktop()).toBe(true)
    expect(isWeb()).toBe(false)
  })

  it('caches the resolved mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    const { getRuntimeMode } = await import('../mode')
    expect(getRuntimeMode()).toBe('desktop')

    // Change the env var after caching
    process.env.ARCHE_RUNTIME_MODE = 'web'
    expect(getRuntimeMode()).toBe('desktop') // still cached
  })
})

describe('desktop environment validation', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('throws when ARCHE_DESKTOP_PLATFORM is missing', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    delete process.env.ARCHE_DESKTOP_PLATFORM
    const { getRuntimeMode, DesktopEnvironmentError } = await import('../mode')
    expect(() => getRuntimeMode()).toThrow(DesktopEnvironmentError)
    expect(() => getRuntimeMode()).toThrow('ARCHE_DESKTOP_PLATFORM')
  })

  it('throws when ARCHE_DESKTOP_PLATFORM is invalid', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'android'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    const { getRuntimeMode, DesktopEnvironmentError } = await import('../mode')
    expect(() => getRuntimeMode()).toThrow(DesktopEnvironmentError)
  })

  it('throws when ARCHE_DESKTOP_WEB_HOST is missing', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    delete process.env.ARCHE_DESKTOP_WEB_HOST
    const { getRuntimeMode, DesktopEnvironmentError } = await import('../mode')
    expect(() => getRuntimeMode()).toThrow(DesktopEnvironmentError)
    expect(() => getRuntimeMode()).toThrow('ARCHE_DESKTOP_WEB_HOST')
  })

  it('throws when ARCHE_DESKTOP_WEB_HOST is not loopback', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '0.0.0.0'
    const { getRuntimeMode, DesktopEnvironmentError } = await import('../mode')
    expect(() => getRuntimeMode()).toThrow(DesktopEnvironmentError)
    expect(() => getRuntimeMode()).toThrow('loopback')
  })

  it('throws when ARCHE_DESKTOP_WEB_HOST is a public IP', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'linux'
    process.env.ARCHE_DESKTOP_WEB_HOST = '192.168.1.100'
    const { getRuntimeMode, DesktopEnvironmentError } = await import('../mode')
    expect(() => getRuntimeMode()).toThrow(DesktopEnvironmentError)
  })

  it('accepts localhost as valid loopback host', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'win32'
    process.env.ARCHE_DESKTOP_WEB_HOST = 'localhost'
    const { getRuntimeMode } = await import('../mode')
    expect(getRuntimeMode()).toBe('desktop')
  })

  it('accepts ::1 as valid loopback host', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'linux'
    process.env.ARCHE_DESKTOP_WEB_HOST = '::1'
    const { getRuntimeMode } = await import('../mode')
    expect(getRuntimeMode()).toBe('desktop')
  })

  it('accepts all valid platforms', async () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      vi.resetModules()
      process.env = { ...originalEnv }
      process.env.ARCHE_RUNTIME_MODE = 'desktop'
      process.env.ARCHE_DESKTOP_PLATFORM = platform
      process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
      const { getRuntimeMode } = await import('../mode')
      expect(getRuntimeMode()).toBe('desktop')
    }
  })

  it('validateDesktopEnvironment can be called directly', async () => {
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    const { validateDesktopEnvironment } = await import('../mode')
    expect(() => validateDesktopEnvironment()).not.toThrow()
  })

  it('validateDesktopEnvironment throws with clear message about Electron', async () => {
    delete process.env.ARCHE_DESKTOP_PLATFORM
    const { validateDesktopEnvironment } = await import('../mode')
    expect(() => validateDesktopEnvironment()).toThrow('Electron shell')
  })
})

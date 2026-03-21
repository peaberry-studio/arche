import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('getInstanceUrl', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.ARCHE_RUNTIME_MODE
    delete process.env.ARCHE_DESKTOP_OPENCODE_PORT
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('uses container hostnames in web mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'web'

    const { getInstanceUrl } = await import('../client')

    expect(getInstanceUrl('alice')).toBe('http://opencode-alice:4096')
  })

  it('uses loopback with the default desktop port in desktop mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'

    const { getInstanceUrl } = await import('../client')

    expect(getInstanceUrl('local')).toBe('http://127.0.0.1:4096')
  })

  it('uses the runtime-selected desktop port when available', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    process.env.ARCHE_DESKTOP_OPENCODE_PORT = '4196'

    const { getInstanceUrl } = await import('../client')

    expect(getInstanceUrl('local')).toBe('http://127.0.0.1:4196')
  })
})

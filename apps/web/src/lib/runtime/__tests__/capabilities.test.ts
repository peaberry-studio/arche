import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('runtime capabilities', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns full capabilities in web mode', async () => {
    delete process.env.ARCHE_RUNTIME_MODE
    const { getRuntimeCapabilities } = await import('../capabilities')
    const caps = getRuntimeCapabilities()

    expect(caps.multiUser).toBe(true)
    expect(caps.auth).toBe(true)
    expect(caps.containers).toBe(true)
    expect(caps.workspaceAgent).toBe(true)
    expect(caps.reaper).toBe(true)
    expect(caps.csrf).toBe(true)
    expect(caps.twoFactor).toBe(true)
    expect(caps.teamManagement).toBe(true)
    expect(caps.connectors).toBe(true)
    expect(caps.kickstart).toBe(true)
    expect(caps.autopilot).toBe(true)
    expect(caps.slackIntegration).toBe(true)
    expect(caps.googleWorkspaceIntegration).toBe(true)
  })

  it('returns restricted capabilities in desktop mode', async () => {
    process.env.ARCHE_RUNTIME_MODE = 'desktop'
    process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
    process.env.ARCHE_DESKTOP_WEB_HOST = '127.0.0.1'
    const { getRuntimeCapabilities } = await import('../capabilities')
    const caps = getRuntimeCapabilities()

    expect(caps.multiUser).toBe(false)
    expect(caps.auth).toBe(false)
    expect(caps.containers).toBe(false)
    expect(caps.workspaceAgent).toBe(true)
    expect(caps.reaper).toBe(false)
    expect(caps.csrf).toBe(false)
    expect(caps.twoFactor).toBe(false)
    expect(caps.teamManagement).toBe(false)
    expect(caps.connectors).toBe(true)
    expect(caps.kickstart).toBe(true)
    expect(caps.autopilot).toBe(false)
    expect(caps.slackIntegration).toBe(false)
    expect(caps.googleWorkspaceIntegration).toBe(false)
  })

  it('always returns a valid object (no undefined fields)', async () => {
    const { getRuntimeCapabilities } = await import('../capabilities')
    const caps = getRuntimeCapabilities()
    const values = Object.values(caps)
    expect(values.every((v) => typeof v === 'boolean')).toBe(true)
  })
})

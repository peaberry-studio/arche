import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeCapabilities } from '../capabilities'

describe('capability enforcement matrix', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  type ModeConfig = {
    name: string
    env: Record<string, string | undefined>
  }

  const webMode: ModeConfig = {
    name: 'web',
    env: { ARCHE_RUNTIME_MODE: undefined },
  }

  const desktopMode: ModeConfig = {
    name: 'desktop',
    env: {
      ARCHE_RUNTIME_MODE: 'desktop',
      ARCHE_DESKTOP_PLATFORM: 'darwin',
      ARCHE_DESKTOP_WEB_HOST: '127.0.0.1',
    },
  }

  function applyEnv(mode: ModeConfig) {
    for (const [key, value] of Object.entries(mode.env)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }

  type CapabilityExpectation = {
    capability: keyof RuntimeCapabilities
    web: boolean
    desktop: boolean
  }

  const capabilityMatrix: CapabilityExpectation[] = [
    { capability: 'multiUser', web: true, desktop: false },
    { capability: 'auth', web: true, desktop: false },
    { capability: 'containers', web: true, desktop: false },
    { capability: 'workspaceAgent', web: true, desktop: true },
    { capability: 'reaper', web: true, desktop: false },
    { capability: 'csrf', web: true, desktop: true },
    { capability: 'twoFactor', web: true, desktop: false },
    { capability: 'teamManagement', web: true, desktop: false },
    { capability: 'connectors', web: true, desktop: false },
    { capability: 'kickstart', web: true, desktop: true },
  ]

  describe.each([webMode, desktopMode])('$name mode', (mode) => {
    it.each(capabilityMatrix)(
      '$capability should be $' + mode.name,
      async ({ capability, ...expected }) => {
        applyEnv(mode)
        const { getRuntimeCapabilities } = await import('../capabilities')
        const caps = getRuntimeCapabilities()
        expect(caps[capability]).toBe(expected[mode.name as 'web' | 'desktop'])
      }
    )
  })

  describe('requireCapability in web mode', () => {
    it('returns null (allowed) for all capabilities', async () => {
      applyEnv(webMode)
      const { requireCapability } = await import('../require-capability')

      for (const { capability } of capabilityMatrix) {
        expect(requireCapability(capability)).toBeNull()
      }
    })
  })

  describe('requireCapability in desktop mode', () => {
    it('blocks disabled capabilities with 403', async () => {
      applyEnv(desktopMode)
      const { requireCapability } = await import('../require-capability')

      const disabled = capabilityMatrix.filter((c) => !c.desktop)
      for (const { capability } of disabled) {
        const res = requireCapability(capability)
        expect(res).not.toBeNull()
        expect(res!.status).toBe(403)
      }
    })

    it('allows enabled capabilities', async () => {
      applyEnv(desktopMode)
      const { requireCapability } = await import('../require-capability')

      const enabled = capabilityMatrix.filter((c) => c.desktop)
      for (const { capability } of enabled) {
        expect(requireCapability(capability)).toBeNull()
      }
    })
  })
})

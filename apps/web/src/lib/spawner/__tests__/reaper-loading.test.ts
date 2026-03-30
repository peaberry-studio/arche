import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('reaper module loading', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('does not load docker while importing the reaper module', async () => {
    vi.doMock('../docker', () => {
      throw new Error('docker module should not load during reaper import')
    })

    try {
      const reaperModule = await import('../reaper')
      expect(reaperModule.startReaper).toBeTypeOf('function')
      expect(reaperModule.stopReaper).toBeTypeOf('function')
    } finally {
      vi.doUnmock('../docker')
      vi.resetModules()
    }
  })
})

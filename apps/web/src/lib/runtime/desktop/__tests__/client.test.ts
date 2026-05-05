import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isDesktopBridgeAvailable,
  getOptionalDesktopBridge,
  getDesktopBridge,
  getDesktopPlatform,
} from '../client'

describe('desktop client', () => {
  const originalWindow = globalThis.window

  beforeEach(() => {
    // @ts-expect-error - resetting window for tests
    delete globalThis.window
  })

  afterEach(() => {
    // @ts-expect-error - restoring window
    globalThis.window = originalWindow
  })

  describe('isDesktopBridgeAvailable', () => {
    it('returns false when window is undefined', () => {
      expect(isDesktopBridgeAvailable()).toBe(false)
    })

    it('returns false when arche bridge is missing', () => {
      // @ts-expect-error - mocking window
      globalThis.window = {}
      expect(isDesktopBridgeAvailable()).toBe(false)
    })

    it('returns false when bridge desktop property is missing', () => {
      // @ts-expect-error - mocking window
      globalThis.window = { arche: { isDesktop: true } }
      expect(isDesktopBridgeAvailable()).toBe(false)
    })

    it('returns false when isDesktop is false', () => {
      // @ts-expect-error - mocking window
      globalThis.window = { arche: { isDesktop: false, desktop: {} } }
      expect(isDesktopBridgeAvailable()).toBe(false)
    })

    it('returns true when desktop bridge is fully available', () => {
      const desktopBridge = {
        createVault: vi.fn(),
        getCurrentVault: vi.fn(),
        listRecentVaults: vi.fn(),
        openExistingVault: vi.fn(),
        openVault: vi.fn(),
        openVaultLauncher: vi.fn(),
        pickVaultParentDirectory: vi.fn(),
        quitLauncherProcess: vi.fn(),
        revealAttachmentsDirectory: vi.fn(),
      }
      // @ts-expect-error - mocking window
      globalThis.window = { arche: { isDesktop: true, desktop: desktopBridge } }
      expect(isDesktopBridgeAvailable()).toBe(true)
    })
  })

  describe('getOptionalDesktopBridge', () => {
    it('returns null when bridge is unavailable', () => {
      expect(getOptionalDesktopBridge()).toBeNull()
    })

    it('returns the desktop bridge when available', () => {
      const desktopBridge = {
        createVault: vi.fn(),
        getCurrentVault: vi.fn(),
        listRecentVaults: vi.fn(),
        openExistingVault: vi.fn(),
        openVault: vi.fn(),
        openVaultLauncher: vi.fn(),
        pickVaultParentDirectory: vi.fn(),
        quitLauncherProcess: vi.fn(),
        revealAttachmentsDirectory: vi.fn(),
      }
      // @ts-expect-error - mocking window
      globalThis.window = { arche: { isDesktop: true, desktop: desktopBridge } }
      expect(getOptionalDesktopBridge()).toBe(desktopBridge)
    })
  })

  describe('getDesktopBridge', () => {
    it('throws when bridge is unavailable', () => {
      expect(() => getDesktopBridge()).toThrow('Desktop bridge is unavailable')
    })

    it('returns the desktop bridge when available', () => {
      const desktopBridge = {
        createVault: vi.fn(),
        getCurrentVault: vi.fn(),
        listRecentVaults: vi.fn(),
        openExistingVault: vi.fn(),
        openVault: vi.fn(),
        openVaultLauncher: vi.fn(),
        pickVaultParentDirectory: vi.fn(),
        quitLauncherProcess: vi.fn(),
        revealAttachmentsDirectory: vi.fn(),
      }
      // @ts-expect-error - mocking window
      globalThis.window = { arche: { isDesktop: true, desktop: desktopBridge } }
      expect(getDesktopBridge()).toBe(desktopBridge)
    })
  })

  describe('getDesktopPlatform', () => {
    it('returns null when window is undefined', () => {
      expect(getDesktopPlatform()).toBeNull()
    })

    it('returns null when arche is missing', () => {
      // @ts-expect-error - mocking window
      globalThis.window = {}
      expect(getDesktopPlatform()).toBeNull()
    })

    it('returns the platform when set', () => {
      // @ts-expect-error - mocking window
      globalThis.window = { arche: { platform: 'darwin' } }
      expect(getDesktopPlatform()).toBe('darwin')
    })
  })
})

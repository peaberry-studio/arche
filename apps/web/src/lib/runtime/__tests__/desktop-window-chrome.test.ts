import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { shouldUseMacOsInsetTitleBar, shouldUseCurrentMacOsInsetTitleBar } from '../desktop-window-chrome'

const mockGetRuntimeMode = vi.hoisted(() => vi.fn())

vi.mock('@/lib/runtime/mode', () => ({
  getRuntimeMode: () => mockGetRuntimeMode(),
}))

describe('desktop window chrome', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('enables inset title bars for macOS desktop runtime', () => {
    expect(
      shouldUseMacOsInsetTitleBar({
        runtimeMode: 'desktop',
        desktopPlatform: 'darwin',
      }),
    ).toBe(true)
  })

  it('disables inset title bars outside macOS desktop runtime', () => {
    expect(
      shouldUseMacOsInsetTitleBar({
        runtimeMode: 'web',
        desktopPlatform: 'darwin',
      }),
    ).toBe(false)

    expect(
      shouldUseMacOsInsetTitleBar({
        runtimeMode: 'desktop',
        desktopPlatform: 'linux',
      }),
    ).toBe(false)
  })

  it('normalizes the reported desktop platform', () => {
    expect(
      shouldUseMacOsInsetTitleBar({
        runtimeMode: 'desktop',
        desktopPlatform: '  Darwin  ',
      }),
    ).toBe(true)
  })

  it('handles null and undefined platform values', () => {
    expect(
      shouldUseMacOsInsetTitleBar({
        runtimeMode: 'desktop',
        desktopPlatform: null,
      }),
    ).toBe(false)

    expect(
      shouldUseMacOsInsetTitleBar({
        runtimeMode: 'desktop',
        desktopPlatform: undefined,
      }),
    ).toBe(false)
  })

  it('returns false for empty string platform', () => {
    expect(
      shouldUseMacOsInsetTitleBar({
        runtimeMode: 'desktop',
        desktopPlatform: '   ',
      }),
    ).toBe(false)
  })

  describe('shouldUseCurrentMacOsInsetTitleBar', () => {
    it('returns true when in desktop mode on macOS', () => {
      mockGetRuntimeMode.mockReturnValue('desktop')
      process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
      expect(shouldUseCurrentMacOsInsetTitleBar()).toBe(true)
    })

    it('returns false when in web mode', () => {
      mockGetRuntimeMode.mockReturnValue('web')
      process.env.ARCHE_DESKTOP_PLATFORM = 'darwin'
      expect(shouldUseCurrentMacOsInsetTitleBar()).toBe(false)
    })

    it('returns false when desktop platform is linux', () => {
      mockGetRuntimeMode.mockReturnValue('desktop')
      process.env.ARCHE_DESKTOP_PLATFORM = 'linux'
      expect(shouldUseCurrentMacOsInsetTitleBar()).toBe(false)
    })

    it('handles missing ARCHE_DESKTOP_PLATFORM env var', () => {
      mockGetRuntimeMode.mockReturnValue('desktop')
      delete process.env.ARCHE_DESKTOP_PLATFORM
      expect(shouldUseCurrentMacOsInsetTitleBar()).toBe(false)
    })
  })
})

import { describe, expect, it } from 'vitest'

import { shouldUseMacOsInsetTitleBar } from '../desktop-window-chrome'

describe('desktop window chrome', () => {
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
})

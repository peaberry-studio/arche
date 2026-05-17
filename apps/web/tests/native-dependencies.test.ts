import { readdirSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, it } from 'vitest'

const requiredDarwinNativePackages = ['lightningcss-darwin-arm64', 'lightningcss-darwin-x64']

describe('native dependencies', () => {
  it('installs lightningcss native packages for both macOS release architectures', () => {
    const pnpmStorePath = resolve(process.cwd(), 'node_modules', '.pnpm')
    const installedPackages = readdirSync(pnpmStorePath)

    for (const packageName of requiredDarwinNativePackages) {
      expect(
        installedPackages.some((installedPackage) => installedPackage.startsWith(`${packageName}@`)),
        `${packageName} is installed`,
      ).toBe(true)
    }
  })
})

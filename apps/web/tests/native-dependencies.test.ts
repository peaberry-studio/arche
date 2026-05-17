import { readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, it } from 'vitest'

const requiredDarwinNativePackages = ['lightningcss-darwin-arm64', 'lightningcss-darwin-x64']
const repoRoot = resolve(process.cwd(), '..', '..')
const webRoot = process.cwd()

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function readWebFile(path: string) {
  return readFileSync(resolve(webRoot, path), 'utf8')
}

describe('native dependencies', () => {
  it('configures pnpm to resolve optional native packages for both macOS release architectures', () => {
    const workspaceConfig = readWebFile('pnpm-workspace.yaml')

    expect(workspaceConfig).toMatch(/^supportedArchitectures:/m)
    expect(workspaceConfig).toMatch(/^  os:\n(?:^    - .*\n)*^    - darwin$/m)
    expect(workspaceConfig).toMatch(/^  cpu:\n(?:^    - .*\n)*^    - x64$/m)
    expect(workspaceConfig).toMatch(/^  cpu:\n(?:^    - .*\n)*^    - arm64$/m)
  })

  it('locks lightningcss native packages for both macOS release architectures', () => {
    const lockfile = readWebFile('pnpm-lock.yaml')

    for (const packageName of requiredDarwinNativePackages) {
      expect(lockfile, `${packageName} has a package snapshot`).toMatch(
        new RegExp(`^  ${packageName}@\\d+\\.\\d+\\.\\d+:$`, 'm'),
      )
      expect(lockfile, `${packageName} is linked from lightningcss optionalDependencies`).toMatch(
        new RegExp(`^      ${packageName}: \\d+\\.\\d+\\.\\d+$`, 'm'),
      )
    }
  })

  it('prepares fresh target-architecture web native dependencies before each release build', () => {
    const releaseScript = readRepoFile('scripts/create-local-release.sh')
    const clearArchFunctionIndex = releaseScript.indexOf('clear_arch_build_artifacts()')
    const verifyFunctionIndex = releaseScript.indexOf('verify_web_native_dependencies_for_arch()')
    const buildArchFunctionIndex = releaseScript.indexOf('build_arch()')
    const nodeModulesResetIndex = releaseScript.indexOf('rm -rf "$WEB_DIR/node_modules"', clearArchFunctionIndex)
    const syncCallIndex = releaseScript.indexOf('sync_web_dependencies_for_arch "$arch"', buildArchFunctionIndex)
    const verifyCallIndex = releaseScript.indexOf('verify_web_native_dependencies_for_arch "$arch"', buildArchFunctionIndex)
    const buildWebCallIndex = releaseScript.indexOf('build_web_for_arch "$arch"', buildArchFunctionIndex)

    expect(clearArchFunctionIndex).toBeGreaterThan(-1)
    expect(nodeModulesResetIndex).toBeGreaterThan(clearArchFunctionIndex)
    expect(nodeModulesResetIndex).toBeLessThan(verifyFunctionIndex)
    expect(verifyFunctionIndex).toBeGreaterThan(-1)
    expect(syncCallIndex).toBeGreaterThan(buildArchFunctionIndex)
    expect(verifyCallIndex).toBeGreaterThan(syncCallIndex)
    expect(buildWebCallIndex).toBeGreaterThan(verifyCallIndex)
  })
})

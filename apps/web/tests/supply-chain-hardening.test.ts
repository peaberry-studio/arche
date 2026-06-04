import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve(process.cwd(), '..', '..')

const directDependencyManifests = [
  'apps/web/package.json',
  'apps/desktop/package.json',
  'infra/workspace-image/opencode-config/package.json',
]

const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

const exactSemverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const sheetJsPinnedTarballPattern = /^https:\/\/cdn\.sheetjs\.com\/xlsx-(\d+\.\d+\.\d+)\/xlsx-\1\.tgz$/

const pnpmWorkspaceConfigs = [
  { configPath: 'apps/web/pnpm-workspace.yaml', rootPath: 'apps/web' },
  { configPath: 'apps/desktop/pnpm-workspace.yaml', rootPath: 'apps/desktop' },
]

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJsonRepoFile(path: string) {
  const parsed: unknown = JSON.parse(readRepoFile(path))
  if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`)
  return parsed
}

function getPnpmConfigValue(workspaceRootPath: string, key: string) {
  return execFileSync('pnpm', ['config', 'get', key], {
    cwd: resolve(repoRoot, workspaceRootPath),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function getPnpmVersion(workspaceRootPath: string) {
  return execFileSync('pnpm', ['--version'], {
    cwd: resolve(repoRoot, workspaceRootPath),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function isPinnedDependencySpec(dependencyName: string, value: unknown) {
  if (typeof value !== 'string') return false
  if (exactSemverPattern.test(value)) return true
  return dependencyName === 'xlsx' && sheetJsPinnedTarballPattern.test(value)
}

describe('supply chain hardening', () => {
  it('configures strict release-age gates in each pnpm workspace', () => {
    for (const { configPath } of pnpmWorkspaceConfigs) {
      const workspaceConfig = readRepoFile(configPath)

      expect(workspaceConfig, `${configPath} pins minimum release age`).toMatch(
        /^minimumReleaseAge: 1440$/m,
      )
      expect(workspaceConfig, `${configPath} enables strict release age`).toMatch(
        /^minimumReleaseAgeStrict: true$/m,
      )
      expect(workspaceConfig, `${configPath} rejects missing publish times`).toMatch(
        /^minimumReleaseAgeIgnoreMissingTime: false$/m,
      )
    }
  })

  it('resolves strict release-age gates through pnpm 11.1.1', () => {
    for (const { rootPath } of pnpmWorkspaceConfigs) {
      expect(getPnpmVersion(rootPath), `${rootPath} uses pnpm 11.1.1`).toBe('11.1.1')
      expect(getPnpmConfigValue(rootPath, 'minimumReleaseAge')).toBe('1440')
      expect(getPnpmConfigValue(rootPath, 'minimumReleaseAgeStrict')).toBe('true')
      expect(getPnpmConfigValue(rootPath, 'minimumReleaseAgeIgnoreMissingTime')).toBe('false')
    }
  }, 30_000)

  it('pins direct dependency specs exactly', () => {
    for (const manifestPath of directDependencyManifests) {
      const manifest = readJsonRepoFile(manifestPath)

      for (const dependencySection of dependencySections) {
        const dependencies = manifest[dependencySection]
        if (dependencies === undefined) continue
        if (!isRecord(dependencies)) throw new Error(`${manifestPath} ${dependencySection} must be an object`)

        for (const [dependencyName, dependencySpec] of Object.entries(dependencies)) {
          expect(
            isPinnedDependencySpec(dependencyName, dependencySpec),
            `${manifestPath} ${dependencySection}.${dependencyName} must be an exact semver or pinned tarball`,
          ).toBe(true)
        }
      }
    }
  })

  it('uses a fixed SheetJS tarball with lockfile integrity', () => {
    const packageJson = readJsonRepoFile('infra/workspace-image/opencode-config/package.json')
    const dependencies = packageJson.dependencies
    if (!isRecord(dependencies)) throw new Error('opencode config dependencies must be an object')

    expect(dependencies.xlsx).toBe('https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz')

    const packageLock = readJsonRepoFile('infra/workspace-image/opencode-config/package-lock.json')
    const packages = packageLock.packages
    if (!isRecord(packages)) throw new Error('opencode config package-lock packages must be an object')

    const xlsxPackage = packages['node_modules/xlsx']
    if (!isRecord(xlsxPackage)) throw new Error('opencode config package-lock must include xlsx')

    expect(xlsxPackage.version).toBe('0.20.3')
    expect(xlsxPackage.resolved).toBe('https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz')
    expect(xlsxPackage.integrity).toMatch(/^sha512-/)
  })

  it('uses lockfile-based scriptless installs for opencode config tools', () => {
    const lockfilePath = resolve(repoRoot, 'infra/workspace-image/opencode-config/package-lock.json')
    expect(existsSync(lockfilePath)).toBe(true)
    expect(readFileSync(lockfilePath, 'utf8')).toMatch(/"lockfileVersion":/)

    const containerfile = readRepoFile('infra/workspace-image/Containerfile')
    expect(containerfile).toContain(
      'COPY opencode-config/package-lock.json /opt/arche/opencode-config/package-lock.json',
    )
    expect(containerfile).toContain('RUN npm ci --omit=dev --ignore-scripts')

    const prepareRuntimeScript = readRepoFile('scripts/prepare-desktop-runtime.sh')
    expect(prepareRuntimeScript).toContain(
      'cp "$OPENCODE_CONFIG_SOURCE_DIR/package-lock.json" "$OPENCODE_CONFIG_OUTPUT_DIR/package-lock.json"',
    )
    expect(prepareRuntimeScript).toContain('npm ci --omit=dev --ignore-scripts')
  })

  it('uses a frozen lockfile for dev server installs', () => {
    const devServerScript = readRepoFile('apps/web/scripts/dev-server.sh')

    expect(devServerScript).toContain('pnpm install --frozen-lockfile --prefer-offline')
  })
})

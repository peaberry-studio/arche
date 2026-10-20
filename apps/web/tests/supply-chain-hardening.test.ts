import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const repoRoot = resolve(process.cwd(), '..', '..')

const directDependencyManifests = [
  'apps/web/package.json',
  'apps/desktop/package.json',
  'infra/workspace-image/arche-tools/package.json',
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
  if (dependencyName === '@arche/desktop-runtime' && value === 'link:../desktop-runtime') {
    return true
  }
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

  it('does not declare a root pnpm workspace aggregating the apps', () => {
    expect(
      existsSync(resolve(repoRoot, 'pnpm-workspace.yaml')),
      'repo root must not contain a pnpm-workspace.yaml',
    ).toBe(false)

    const rootConfigList = execFileSync('pnpm', ['config', 'list'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(rootConfigList, 'root pnpm config must not define workspace packages').not.toMatch(/"packages"/)
    expect(rootConfigList, 'root pnpm config must not define workspace allowBuilds').not.toMatch(/"allowBuilds"/)
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
            `${manifestPath} ${dependencySection}.${dependencyName} must be an exact semver, pinned tarball, or approved local link`,
          ).toBe(true)
        }
      }
    }
  })

  it('uses a fixed SheetJS tarball with lockfile integrity', () => {
    const packageJson = readJsonRepoFile('infra/workspace-image/arche-tools/package.json')
    const dependencies = packageJson.dependencies
    if (!isRecord(dependencies)) throw new Error('arche-tools dependencies must be an object')

    expect(dependencies.xlsx).toBe('https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz')

    const packageLock: unknown = parse(readRepoFile('infra/workspace-image/arche-tools/pnpm-lock.yaml'))
    if (!isRecord(packageLock)) throw new Error('arche-tools lockfile must be an object')
    const packages = packageLock.packages
    if (!isRecord(packages)) throw new Error('arche-tools lockfile packages must be an object')

    const xlsxPackage = packages['xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz']
    if (!isRecord(xlsxPackage)) throw new Error('arche-tools lockfile must include xlsx')

    const resolution = xlsxPackage.resolution
    if (!isRecord(resolution)) throw new Error('xlsx must include a locked resolution')
    expect(resolution.tarball).toBe('https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz')
    expect(resolution.integrity).toMatch(/^sha512-/)
  })

  it('uses lockfile-based scriptless installs for arche-tools', () => {
    const lockfilePath = resolve(repoRoot, 'infra/workspace-image/arche-tools/pnpm-lock.yaml')
    expect(existsSync(lockfilePath)).toBe(true)
    expect(readFileSync(lockfilePath, 'utf8')).toMatch(/^lockfileVersion:/m)

    const containerfile = readRepoFile('infra/workspace-image/Containerfile')
    expect(containerfile).toContain(
      'COPY arche-tools/pnpm-lock.yaml ./pnpm-lock.yaml',
    )
    expect(containerfile).toContain('RUN pnpm install --frozen-lockfile --prod --ignore-scripts')

    const prepareRuntimeScript = readRepoFile('scripts/prepare-desktop-runtime.sh')
    expect(prepareRuntimeScript).toContain(
      'cp "$ARCHE_TOOLS_SOURCE_DIR/pnpm-lock.yaml" "$ARCHE_TOOLS_OUTPUT_DIR/pnpm-lock.yaml"',
    )
    expect(prepareRuntimeScript).toContain('pnpm install --prod --frozen-lockfile --ignore-scripts')
  })

  it('uses a frozen lockfile for dev server installs', () => {
    const devServerScript = readRepoFile('apps/web/scripts/dev-server.sh')

    expect(devServerScript).toContain('pnpm install --frozen-lockfile --prefer-offline')
  })
})

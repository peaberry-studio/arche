import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve(process.cwd(), '..', '..')

const directDependencyManifests = [
  'apps/web/package.json',
  'apps/desktop/package.json',
  'infra/workspace-image/opencode-config/package.json',
]

const pnpmWorkspaceConfigs = ['apps/web/pnpm-workspace.yaml', 'apps/desktop/pnpm-workspace.yaml']

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('supply chain hardening', () => {
  it('configures strict release-age gates in each pnpm workspace', () => {
    for (const workspaceConfigPath of pnpmWorkspaceConfigs) {
      const workspaceConfig = readRepoFile(workspaceConfigPath)

      expect(workspaceConfig, `${workspaceConfigPath} pins minimum release age`).toMatch(
        /^minimumReleaseAge: 1440$/m,
      )
      expect(workspaceConfig, `${workspaceConfigPath} enables strict release age`).toMatch(
        /^minimumReleaseAgeStrict: true$/m,
      )
      expect(workspaceConfig, `${workspaceConfigPath} rejects missing publish times`).toMatch(
        /^minimumReleaseAgeIgnoreMissingTime: false$/m,
      )
    }
  })

  it('pins direct dependency ranges exactly', () => {
    for (const manifestPath of directDependencyManifests) {
      const manifest = readRepoFile(manifestPath)

      expect(manifest, `${manifestPath} has no caret ranges`).not.toMatch(/"\s*:\s*"\^/)
      expect(manifest, `${manifestPath} has no tilde ranges`).not.toMatch(/"\s*:\s*"~/)
    }
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

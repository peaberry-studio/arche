const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

test('bundles the Arche MCP server with frozen scriptless pnpm dependencies and refreshes changed sources', () => {
  const root = mkdtempSync(join(__dirname, 'arche-desktop-runtime-'))
  const scripts = join(root, 'scripts')
  const source = join(root, 'infra/workspace-image/arche-tools')
  const output = join(root, 'apps/desktop/bin/arche-tools')
  const mockBin = join(root, 'mock-bin')

  try {
    mkdirSync(scripts, { recursive: true })
    mkdirSync(join(source, 'shared'), { recursive: true })
    mkdirSync(join(source, 'tools'), { recursive: true })
    mkdirSync(mockBin)
    mkdirSync(join(root, 'versions'))
    writeFileSync(join(root, 'versions/opencode.version'), '2.0.32\n')
    writeFileSync(join(root, 'versions/opencode-v1.version'), '1.18.18\n')
    copyFileSync(resolve(__dirname, '../../../scripts/prepare-desktop-runtime.sh'), join(scripts, 'prepare-desktop-runtime.sh'))
    for (const name of ['download-node.sh', 'download-opencode.sh', 'build-workspace-agent.sh']) {
      writeFileSync(join(scripts, name), '#!/usr/bin/env bash\nexit 0\n')
    }
    writeFileSync(join(scripts, 'download-opencode.sh'), '#!/usr/bin/env bash\nprintf "%s %s\\n" "$1" "${3:-opencode}" >> "$2/download-calls"\n')
    writeFileSync(join(mockBin, 'pnpm'), '#!/usr/bin/env bash\nmkdir -p node_modules\nprintf "%s\\n" "$*" >> install-calls\n', { mode: 0o755 })
    writeFileSync(join(source, 'package.json'), '{"name":"arche-tools","type":"module"}')
    writeFileSync(join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    writeFileSync(join(source, 'server.js'), 'export const server = true\n')
    writeFileSync(join(source, 'shared/tool.js'), 'export const tool = true\n')
    writeFileSync(join(source, 'tools/chart.js'), 'export const chart = true\n')

    const prepare = () => {
      const result = spawnSync('bash', [join(scripts, 'prepare-desktop-runtime.sh')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${mockBin}:${process.env.PATH}`,
          NODE_RUNTIME_VERSION: '22.0.0',
          OPENCODE_VERSION: '',
          FORCE_DOWNLOAD: '0',
        },
      })
      assert.equal(result.status, 0, result.stderr)
    }

    prepare()
    assert.equal(readFileSync(join(root, 'apps/desktop/bin/download-calls'), 'utf8'), '2.0.32 opencode\n1.18.18 opencode-v1\n')
    assert.equal(readFileSync(join(output, 'server.js'), 'utf8'), 'export const server = true\n')
    assert.equal(readFileSync(join(output, 'shared/tool.js'), 'utf8'), 'export const tool = true\n')
    assert.equal(readFileSync(join(output, 'tools/chart.js'), 'utf8'), 'export const chart = true\n')
    assert.equal(
      readFileSync(join(output, 'install-calls'), 'utf8'),
      `install --prod --frozen-lockfile --ignore-scripts --node-linker=hoisted --store-dir ${root}/apps/desktop/bin/.pnpm-store\n`,
    )

    writeFileSync(join(source, 'server.js'), 'export const server = "updated"\n')
    prepare()
    assert.equal(readFileSync(join(output, 'server.js'), 'utf8'), 'export const server = "updated"\n')
    assert.equal(readFileSync(join(output, 'install-calls'), 'utf8').trim().split('\n').length, 1)

    writeFileSync(join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\nimporters: {}\n')
    prepare()
    assert.equal(readFileSync(join(output, 'install-calls'), 'utf8').trim().split('\n').length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('downloads and caches both OpenCode versions independently without overwriting legacy artifacts', () => {
  const root = mkdtempSync(join(__dirname, 'arche-opencode-download-'))
  const output = join(root, 'bin')
  const mockBin = join(root, 'mock-bin')
  const currentSource = join(root, 'current')
  const legacySource = join(root, 'legacy')
  const currentArchive = join(root, 'current.tgz')
  const legacyArchive = join(root, 'legacy.tar.gz')
  const metadataPath = join(root, 'metadata.json')
  const callsPath = join(root, 'curl-calls')

  try {
    mkdirSync(join(currentSource, 'package/bin'), { recursive: true })
    mkdirSync(legacySource)
    mkdirSync(mockBin)
    writeFileSync(join(currentSource, 'package/bin/opencode'), 'current-binary', { mode: 0o755 })
    writeFileSync(join(legacySource, 'opencode'), 'legacy-binary', { mode: 0o755 })
    for (const [source, archive] of [[currentSource, currentArchive], [legacySource, legacyArchive]]) {
      const result = spawnSync('tar', ['-czf', archive, '-C', source, '.'], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
    }
    writeFileSync(metadataPath, JSON.stringify({
      version: '2.0.32',
      dist: { integrity: `sha512-${createHash('sha512').update(readFileSync(currentArchive)).digest('base64')}` },
    }))
    writeFileSync(join(mockBin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$CURL_CALLS"
case "$url" in
  */cli-linux-x64-2.0.32.tgz) cp "$CURRENT_ARCHIVE" "$output" ;;
  */cli-linux-x64/2.0.32) cp "$CURRENT_METADATA" "$output" ;;
  */opencode-linux-x64.tar.gz) cp "$LEGACY_ARCHIVE" "$output" ;;
  *.sha256) exit 22 ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 })

    const download = (version, name, force = '0') => spawnSync('bash', [
      resolve(__dirname, '../../../scripts/download-opencode.sh'), version, output, name,
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${mockBin}:${process.env.PATH}`,
        OPENCODE_PLATFORM: 'linux-x64',
        FORCE_DOWNLOAD: force,
        CURL_CALLS: callsPath,
        CURRENT_ARCHIVE: currentArchive,
        CURRENT_METADATA: metadataPath,
        LEGACY_ARCHIVE: legacyArchive,
      },
    })

    for (const [version, name] of [['2.0.32', 'opencode'], ['1.18.18', 'opencode-v1']]) {
      const result = download(version, name)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(readFileSync(join(output, `${name}.version`), 'utf8'), `${version}\n`)
    }
    assert.equal(readFileSync(join(output, 'opencode'), 'utf8'), 'current-binary')
    assert.equal(readFileSync(join(output, 'opencode-v1'), 'utf8'), 'legacy-binary')
    const calls = readFileSync(callsPath, 'utf8')
    assert.equal(download('2.0.32', 'opencode').status, 0)
    assert.equal(download('1.18.18', 'opencode-v1').status, 0)
    assert.equal(readFileSync(callsPath, 'utf8'), calls)

    writeFileSync(metadataPath, JSON.stringify({ version: '2.0.32', dist: { integrity: 'sha512-invalid' } }))
    const rejected = download('2.0.32', 'opencode', '1')
    assert.equal(rejected.status, 1)
    assert.match(rejected.stderr, /integrity mismatch/)
    assert.equal(readFileSync(join(output, 'opencode'), 'utf8'), 'current-binary')
    assert.equal(readFileSync(join(output, 'opencode-v1'), 'utf8'), 'legacy-binary')
    assert.equal(readFileSync(join(output, 'opencode-v1.version'), 'utf8'), '1.18.18\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

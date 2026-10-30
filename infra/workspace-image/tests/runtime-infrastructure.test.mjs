import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = path => readFileSync(join(root, path), 'utf8')

test('workspace image documentation describes V2-only runtime and archive-only V1', () => {
  const readme = read('infra/workspace-image/README.md')
  assert.match(readme, /OpenCode 2 is the only workspace runtime/)
  assert.match(readme, /OPENCODE_V1_IMAGE=.*` only for history export/)
  assert.match(readme, /There is no rollback to V1/)
  assert.doesNotMatch(readme, /deployment runtime default remains `opencode-v1`|for rollback\/export|both workspace runtimes|Both runtimes discover|shared by V1 and V2/i)
})

test('workspace runtimes are separately pinned and rollback tags survive retention', () => {
  assert.equal(read('versions/opencode.version').trim(), '2.0.32')
  assert.equal(read('versions/opencode-v1.version').trim(), '1.18.18')
  const prepareRuntime = read('scripts/prepare-desktop-runtime.sh')
  assert.match(prepareRuntime, /OPENCODE_VERSION_FILE="\$ROOT_DIR\/versions\/opencode\.version"/)
  assert.match(prepareRuntime, /OPENCODE_V1_VERSION_FILE="\$ROOT_DIR\/versions\/opencode-v1\.version"/)
  const workflow = read('.github/workflows/build-push-workspace.yml')
  assert.match(workflow, /versions\/opencode-v1\.version/)
  assert.match(workflow, /OPENCODE_VERSION=\$\{\{ steps.opencode.outputs.OPENCODE_V1_VERSION \}\}/)
  assert.match(workflow, /MODE != 'pr'.*opencode-v1-1\.18\.18/)
  assert.match(read('.github/workflows/ghcr-retention.yml'), /opencode-v1\(-1/)
})

test('image checks build and smoke-test both runtimes without pruning shared resources', () => {
  const script = read('scripts/check-podman-images.sh')
  assert.doesNotMatch(script, /podman\s+(?:image|system|container)\s+(?:prune|rm)/)
  assert.match(script, /-t arche-workspace:opencode-v1/)
  assert.match(script, /-t arche-workspace:opencode-v2/)
  assert.match(script, /tests\/runtime-smoke\.mjs/)
})

test('web and desktop bundles include the native scratch isolation guard', () => {
  assert.match(read('infra/workspace-image/Containerfile'), /COPY arche-tools\/shared\/scratch-isolation\/\*\.js \.\/shared\/scratch-isolation\//)
  assert.match(read('scripts/prepare-desktop-runtime.sh'), /cp -R "\$ARCHE_TOOLS_SOURCE_DIR\/shared\/scratch-isolation" "\$ARCHE_TOOLS_OUTPUT_DIR\/shared\/scratch-isolation"/)
})

test('new backend images and source-mounted development stacks declare the runtime contract', () => {
  assert.match(read('apps/web/Containerfile'), /LABEL arche\.runtime\.contract=opencode-v2/)
  for (const path of ['infra/compose/compose.yaml', 'infra/deploy/ansible/roles/app/templates/compose.yml.j2']) {
    assert.match(read(path), /arche\.runtime\.contract=opencode-v2/)
  }
  assert.match(read('infra/deploy/ansible/roles/app/tasks/main.yml'), /podman pull \{\{ opencode_v1_image \}\}/)
})

for (const version of ['1.18.18', '2.0.32']) {
  for (const corrupt of [false, true]) {
    test(`download ${version}${corrupt ? ' rejects bad integrity' : ' uses exact version and replaces stale binary'}`, () => {
      const scratch = mkdtempSync(join(root, '.runtime-infra-test-'))
      try {
        const v2 = version.startsWith('2.')
        const payload = join(scratch, 'payload')
        const binaryDir = v2 ? join(payload, 'package/bin') : payload
        mkdirSync(binaryDir, { recursive: true })
        writeFileSync(join(binaryDir, 'opencode'), `fixture ${version}`)
        const archive = join(scratch, 'fixture.tgz')
        assert.equal(spawnSync('tar', ['-czf', archive, '-C', payload, '.']).status, 0)
        const metadata = join(scratch, 'metadata.json')
        const integrity = 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64')
        writeFileSync(metadata, JSON.stringify({ version, dist: { integrity: corrupt ? 'sha512-bad' : integrity }, assets: [{ name: 'opencode-linux-arm64.tar.gz', digest: corrupt ? 'sha256:bad' : 'sha256:' + createHash('sha256').update(readFileSync(archive)).digest('hex') }] }))
        const bin = join(scratch, 'bin')
        mkdirSync(bin)
        writeFileSync(join(bin, 'curl'), `#!/usr/bin/env node
const { appendFileSync, copyFileSync } = require('node:fs')
const args = process.argv.slice(2)
const url = args.at(-1)
appendFileSync(process.env.URL_LOG, url + '\\n')
if (url.endsWith('.sha256')) process.exit(1)
const source = url.endsWith('.tgz') || url.endsWith('.tar.gz') ? process.env.FIXTURE_ARCHIVE : process.env.FIXTURE_METADATA
copyFileSync(source, args[args.indexOf('-o') + 1])
`)
        chmodSync(join(bin, 'curl'), 0o755)
        const output = join(scratch, 'output with spaces')
        mkdirSync(output)
        writeFileSync(join(output, 'opencode'), 'stale binary')
        writeFileSync(join(output, 'opencode.version'), '0.0.0')
        const result = spawnSync('bash', [join(root, 'scripts/download-opencode.sh'), version, output], {
          encoding: 'utf8',
          env: {
            PATH: `${bin}:${process.env.PATH}`, HOME: scratch,
            OPENCODE_PLATFORM: 'linux-arm64', FIXTURE_ARCHIVE: archive, FIXTURE_METADATA: metadata,
            URL_LOG: join(scratch, 'urls.log'),
          },
        })
        assert.equal(result.status, corrupt ? 1 : 0, result.stderr)
        if (corrupt) {
          assert.match(result.stderr, /integrity mismatch/)
          assert.equal(readFileSync(join(output, 'opencode'), 'utf8'), 'stale binary')
          assert.equal(readFileSync(join(output, 'opencode.version'), 'utf8'), '0.0.0')
        } else {
          assert.equal(readFileSync(join(output, 'opencode'), 'utf8'), `fixture ${version}`)
          assert.equal(readFileSync(join(output, 'opencode.version'), 'utf8').trim(), version)
        }
        const urls = readFileSync(join(scratch, 'urls.log'), 'utf8')
        assert.match(urls, v2
          ? /registry\.npmjs\.org\/@opencode\/cli-linux-arm64\/-\/cli-linux-arm64-2\.0\.32\.tgz/
          : /github\.com\/anomalyco\/opencode\/releases\/download\/v1\.18\.18\/opencode-linux-arm64\.tar\.gz/)
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    })
  }
}

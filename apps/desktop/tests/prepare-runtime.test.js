const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
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
    copyFileSync(resolve(__dirname, '../../../scripts/prepare-desktop-runtime.sh'), join(scripts, 'prepare-desktop-runtime.sh'))
    for (const name of ['download-node.sh', 'download-opencode.sh', 'build-workspace-agent.sh']) {
      writeFileSync(join(scripts, name), '#!/usr/bin/env bash\nexit 0\n')
    }
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
          OPENCODE_VERSION: '1.18.18',
          FORCE_DOWNLOAD: '0',
        },
      })
      assert.equal(result.status, 0, result.stderr)
    }

    prepare()
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

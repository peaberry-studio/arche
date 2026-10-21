import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('CI deploy pins the workspace image to the published commit before changing directories', () => {
  const workflow = readFileSync(join(root, '.github/workflows/build-and-deploy.yml'), 'utf8')
  const exportImage = 'export OPENCODE_IMAGE="ghcr.io/peaberry-studio/arche/workspace:$(git rev-parse --short HEAD)"'
  assert.ok(workflow.includes(exportImage))
  assert.ok(workflow.indexOf(exportImage) < workflow.indexOf('cd infra/deploy'))
  assert.doesNotMatch(workflow, /OPENCODE_IMAGE:\s*ghcr\.io\/peaberry-studio\/arche\/workspace:latest/)
})

function fixture(run) {
  const scratch = mkdtempSync(join(tmpdir(), 'arche-deploy-runtime-'))
  try {
    for (const dir of ['infra/deploy', 'infra/workspace-image', 'versions', 'apps/web', 'scripts', 'bin']) mkdirSync(join(scratch, dir), { recursive: true })
    copyFileSync(join(root, 'infra/deploy/deploy.sh'), join(scratch, 'infra/deploy/deploy.sh'))
    writeFileSync(join(scratch, 'versions/opencode.version'), '2.0.32\n')
    writeFileSync(join(scratch, 'versions/opencode-v1.version'), '1.18.18\n')
    writeFileSync(join(scratch, 'infra/workspace-image/Containerfile'), 'FROM fixture\n')
    writeFileSync(join(scratch, 'apps/web/package.json'), '{}')
    for (const script of ['deploy-kb.sh', 'deploy-config.sh']) {
      writeFileSync(join(scratch, 'scripts', script), '#!/bin/sh\nmkdir -p "$1"\n')
      chmodSync(join(scratch, 'scripts', script), 0o755)
    }
    for (const args of [['init', '-b', 'main'], ['add', 'versions', 'infra'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture']]) {
      const result = spawnSync('git', args, { cwd: scratch, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
    }
    const shim = `#!${process.execPath} --
const {appendFileSync,readFileSync,writeFileSync}=require('node:fs')
const {basename}=require('node:path')
const name=basename(process.argv[1]), args=process.argv.slice(2)
appendFileSync(process.env.DEPLOY_COMMANDS, JSON.stringify({name,args})+'\\n')
if(name==='ansible-playbook') {
  const path=args.find(arg=>arg.startsWith('@'))
  if(path) writeFileSync(process.env.DEPLOY_VARS,readFileSync(path.slice(1)))
}
if(name==='ssh') process.stdin.resume()
`
    for (const tool of ['ssh', 'podman', 'ansible', 'ansible-playbook']) {
      writeFileSync(join(scratch, 'bin', tool), shim)
      chmodSync(join(scratch, 'bin', tool), 0o755)
    }
    const env = {
      PATH: `${join(scratch, 'bin')}:${process.env.PATH}`, HOME: scratch,
      DEPLOY_COMMANDS: join(scratch, 'commands.jsonl'), DEPLOY_VARS: join(scratch, 'vars.json'),
      POSTGRES_PASSWORD: 'fixture', ARCHE_SESSION_PEPPER: 'fixture', ARCHE_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      ARCHE_INTERNAL_TOKEN: 'fixture', ARCHE_CONNECTOR_OAUTH_STATE_SECRET: 'fixture', ARCHE_GATEWAY_TOKEN_SECRET: 'fixture',
      ARCHE_SEED_ADMIN_EMAIL: 'fixture@example.invalid', ARCHE_SEED_ADMIN_PASSWORD: 'fixture', ARCHE_SEED_ADMIN_SLUG: 'fixture',
      KB_CONTENT_HOST_PATH: join(scratch, 'kb'), KB_CONFIG_HOST_PATH: join(scratch, 'config'), ARCHE_USERS_PATH: join(scratch, 'users'),
      PODMAN_SOCKET_PATH: join(scratch, 'fixture.sock'),
    }
    run({ scratch, env, execute: (mode, overrides = {}) => spawnSync('bash', [join(scratch, 'infra/deploy/deploy.sh'), ...(mode === 'local-dev' ? ['--local-dev'] : ['--ip', '127.0.0.1', '--domain', 'fixture.invalid', '--acme-email', 'fixture@example.invalid', '--skip-ensure-dns-record'])], { env: { ...env, ...overrides }, encoding: 'utf8' }) })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

for (const mode of ['remote', 'local-dev']) {
  test(`${mode} builds a separate V2 image and passes its exact reference to the new backend`, () => fixture(({ scratch, execute }) => {
    const result = execute(mode)
    assert.equal(result.status, 0, result.stderr)
    const vars = JSON.parse(readFileSync(join(scratch, 'vars.json'), 'utf8'))
    assert.match(vars.opencode_image, /^arche-workspace:opencode-v2-2\.0\.32-[a-f0-9]{12}-[a-f0-9]{12}$/)
    const commands = readFileSync(join(scratch, 'commands.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    const builds = commands.filter(command => command.name === (mode === 'remote' ? 'ssh' : 'podman') && command.args.join(' ').includes('build --build-arg OPENCODE_VERSION=2.0.32'))
    assert.equal(builds.length, 1)
    assert.ok(builds[0].args.join(' ').includes(`-t ${vars.opencode_image}`))
    assert.ok(!commands.some(command => command.args.join(' ').includes('-t arche-workspace:latest')))
  }))
}

for (const reference of ['ghcr.io/fixture/workspace:latest', 'ghcr.io/fixture/workspace:latest-arm64', 'ghcr.io/fixture/workspace']) {
  test(`remote rejects the mutable workspace reference ${reference} before touching the host`, () => fixture(({ scratch, execute }) => {
    const result = execute('remote', { OPENCODE_IMAGE: reference })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /OPENCODE_IMAGE must pin a release\/commit tag or @sha256 digest/)
    assert.throws(() => readFileSync(join(scratch, 'commands.jsonl')), /ENOENT/)
  }))
}

for (const reference of ['ghcr.io/fixture/workspace:v1.2.3', `ghcr.io/fixture/workspace@sha256:${'a'.repeat(64)}`]) {
  test(`remote preserves the pinned workspace reference ${reference}`, () => fixture(({ scratch, execute }) => {
    const result = execute('remote', { OPENCODE_IMAGE: reference })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(readFileSync(join(scratch, 'vars.json'), 'utf8')).opencode_image, reference)
  }))
}

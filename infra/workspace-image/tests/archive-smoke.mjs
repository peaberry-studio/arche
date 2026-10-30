import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const prefix = `arche-archive-smoke-${randomUUID()}`
const volumes = ['work', 'share', 'state'].map(suffix => `${prefix}-${suffix}`)
try {
for (const mode of ['seed', 'archive']) {
const result = spawnSync('podman', [
  'run', '--rm', '-i', '--network', 'none', '--entrypoint', 'node', '--user', '0:0',
  ...(mode === 'archive' ? ['--read-only', '--cap-drop=ALL', '--cap-add=DAC_OVERRIDE', '--security-opt=no-new-privileges',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,mode=1777', '--tmpfs', '/home/workspace:rw,nosuid,nodev,size=2048m,mode=0700',
    '--pids-limit=128', '--memory=2g', '--memory-swap=2g', '--cpus=2'] : []),
  '-e', `ARCHIVE_SMOKE_MODE=${mode}`,
  '-v', `${volumes[0]}:/workspace${mode === 'archive' ? ':ro' : ''}`,
  '-v', `${volumes[1]}:${mode === 'archive' ? '/tmp/arche-archive-source/share:ro' : '/home/workspace/.local/share/opencode'}`,
  '-v', `${volumes[2]}:${mode === 'archive' ? '/tmp/arche-archive-source/state:ro' : '/home/workspace/.local/state/opencode'}`,
  'arche-workspace:opencode-v1', '--input-type=module',
], {
  encoding: 'utf8', timeout: 90_000,
  input: `
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'

const password = randomBytes(24).toString('hex')
const projectConfig = JSON.stringify({
  $schema: 'https://opencode.ai/config.json',
  agent: { ignored_archive_agent: { prompt: 'fixture only' } },
  mcp: { ignored_archive_mcp: { type: 'local', command: ['false'], enabled: false } },
  enabled_providers: ['openai'], plugin: [],
})
const archiveMode = process.env.ARCHIVE_SMOKE_MODE === 'archive'
const sourceRoots = ['/tmp/arche-archive-source/share', '/tmp/arche-archive-source/state']
function snapshot(path) {
  const stat = lstatSync(path)
  return {
    mode: stat.mode, mtime: stat.mtimeMs,
    ...(stat.isDirectory() ? { entries: readdirSync(path).sort().map(name => [name, snapshot(path + '/' + name)]) }
      : stat.isSymbolicLink() ? { link: readlinkSync(path) }
      : { hash: createHash('sha256').update(readFileSync(path)).digest('hex') }),
  }
}
const before = archiveMode ? sourceRoots.map(snapshot) : undefined
if (!archiveMode) {
  writeFileSync('/workspace/opencode.json', projectConfig)
  assert.equal(spawnSync('git', ['init'], { cwd: '/workspace' }).status, 0)
  writeFileSync('/workspace/fixture.txt', 'Archive project fixture')
  assert.equal(spawnSync('git', ['-c', 'safe.directory=/workspace', 'add', 'fixture.txt'], { cwd: '/workspace' }).status, 0)
  assert.equal(spawnSync('git', ['-c', 'safe.directory=/workspace', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture'], { cwd: '/workspace' }).status, 0)
}
const headers = { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64'), 'Content-Type': 'application/json' }
const request = (path, init = {}) => fetch('http://127.0.0.1:4096' + path, { headers, signal: AbortSignal.timeout(5000), ...init })
let server
async function start(archive) {
  const args = ['serve', '--hostname', '127.0.0.1', '--port', '4096']
  const copyAndServe = 'mkdir -p /home/workspace/.local/share/opencode /home/workspace/.local/state/opencode && ' +
    'cp -R /tmp/arche-archive-source/share/. /home/workspace/.local/share/opencode/ && ' +
    'cp -R /tmp/arche-archive-source/state/. /home/workspace/.local/state/opencode/ && ' +
    'exec opencode "$@"'
  server = spawn(archive ? 'sh' : 'opencode', archive ? ['-c', copyAndServe, 'arche-archive', ...args] : args, {
    cwd: '/workspace', stdio: 'ignore',
    env: {
      PATH: process.env.PATH, HOME: '/home/workspace',
      XDG_DATA_HOME: '/home/workspace/.local/share', XDG_STATE_HOME: '/home/workspace/.local/state',
      XDG_CONFIG_HOME: '/tmp/arche-archive-config', OPENCODE_SERVER_PASSWORD: password,
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '/workspace',
      OPENCODE_DISABLE_MODELS_FETCH: 'true',
      ...(!archive ? { OPENAI_API_KEY: randomBytes(24).toString('hex') } : {}),
      ...(archive ? { OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: {}, plugin: [], enabled_providers: [] }) } : {}),
    },
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Legacy server exited: ' + server.exitCode)
    try { if ((await request('/global/health')).ok) return } catch {}
    await setTimeout(200)
  }
  throw new Error('Archive health deadline')
}
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  server.kill('SIGTERM')
  await Promise.race([new Promise(resolve => server.once('exit', resolve)), setTimeout(3000)])
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL')
    await new Promise(resolve => server.once('exit', resolve))
  }
}
try {
  await start(archiveMode)
  if (!archiveMode) {
  const create = async body => {
    const response = await request('/session', { method: 'POST', body: JSON.stringify(body) })
    assert.equal(response.ok, true, await response.clone().text())
    return response.json()
  }
  const root = await create({ title: 'Archive root fixture' })
  const child = await create({ title: 'Archive child fixture', parentID: root.id })
  const message = await request('/session/' + root.id + '/message', {
    method: 'POST', body: JSON.stringify({ noReply: true, model: { providerID: 'openai', modelID: 'gpt-4o-mini' }, parts: [{ type: 'text', text: 'Preserved archive fixture' }] }),
  })
  assert.equal(message.ok, true, await message.clone().text())
  writeFileSync('/workspace/archive-fixture.json', JSON.stringify({ rootId: root.id, childId: child.id }))
  } else {
  const { rootId, childId } = JSON.parse(readFileSync('/workspace/archive-fixture.json', 'utf8'))
  const config = await (await request('/config')).json()
  assert.deepEqual(config.mcp, {})
  assert.deepEqual(config.agent, {})
  assert.deepEqual(config.plugin, [])
  assert.deepEqual(config.enabled_providers, [])
  const sessionsResponse = await request('/session?roots=false&limit=9007199254740991')
  assert.equal(sessionsResponse.ok, true, await sessionsResponse.clone().text())
  const sessions = await sessionsResponse.json()
  assert.equal(sessions.some(session => session.id === rootId), true)
  const children = await (await request('/session/' + rootId + '/children')).json()
  assert.equal(children.some(session => session.id === childId), true)
  const messages = await (await request('/session/' + rootId + '/message')).json()
  assert.equal(JSON.stringify(messages).includes('Preserved archive fixture'), true)
  assert.equal(readFileSync('/workspace/opencode.json', 'utf8'), projectConfig)
  assert.equal((await fetch('http://127.0.0.1:4096/global/health')).status, 401)
  assert.throws(() => writeFileSync('/workspace/archive-write-probe', 'must fail'), /EROFS/)
  for (const root of sourceRoots) assert.throws(() => writeFileSync(root + '/archive-write-probe', 'must fail'), /EROFS/)
  }
} finally {
  await stop()
  if (archiveMode) {
    assert.deepEqual(sourceRoots.map(snapshot), before, 'Legacy share/state volumes changed during archive')
    console.log('V1 archive: root/child/messages readable from disposable state copies; workspace/share/state sources read-only and unchanged; project config, MCP, plugins and providers disabled; auth required')
  }
}
`,
})
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
assert.equal(result.error, undefined, result.error?.message)
assert.equal(result.status, 0, 'Legacy archive smoke failed')
}
} finally {
  for (const volume of volumes) {
    const cleanup = spawnSync('podman', ['volume', 'rm', volume], { encoding: 'utf8' })
    assert.equal(cleanup.status, 0, cleanup.stderr)
  }
}

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

for (const [image, version] of [
  ['arche-workspace:opencode-v1', '1.18.18'],
  ['arche-workspace:opencode-v2', '2.0.32'],
]) {
  const result = spawnSync('podman', [
    'run', '--rm', '-i', '--network', 'none', '--entrypoint', 'node',
    '-e', `EXPECTED_VERSION=${version}`, image, '--input-type=module',
  ], {
    encoding: 'utf8',
    timeout: 120_000,
    input: `
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

const version = process.env.EXPECTED_VERSION
const v2 = version.startsWith('2.')
assert.match(spawnSync('opencode', ['--version'], { encoding: 'utf8' }).stdout, new RegExp(version.replaceAll('.', '\\\\.')))
mkdirSync('/kb-content', { recursive: true })
assert.equal(spawnSync('git', ['init', '--bare', '/kb-content']).status, 0)
mkdirSync('/tmp/arche-user-data/skills/arche-smoke', { recursive: true })
writeFileSync('/tmp/arche-user-data/skills/arche-smoke/SKILL.md', '---\\nname: arche-smoke\\ndescription: Isolated runtime smoke skill\\n---\\nSmoke fixture only.\\n')
const agent = { description: 'Isolated runtime smoke agent', mode: 'primary', [v2 ? 'system' : 'prompt']: 'Smoke fixture only.' }
writeFileSync('/tmp/arche-user-data/opencode-config.json', JSON.stringify({
  [v2 ? 'agents' : 'agent']: { arche_smoke: agent },
}))
writeFileSync('/tmp/arche-user-data/AGENTS.md', 'Isolated runtime smoke instructions.\\n')
const password = randomBytes(24).toString('hex')
const server = spawn('/usr/local/bin/entrypoint.sh', ['serve', '--hostname', '127.0.0.1', '--port', '4096'], {
  cwd: '/workspace',
  env: {
    PATH: process.env.PATH, HOME: '/home/workspace',
    XDG_CONFIG_HOME: '/home/workspace/.config',
    XDG_DATA_HOME: '/home/workspace/.local/share',
    XDG_STATE_HOME: '/home/workspace/.local/state',
    XDG_CACHE_HOME: '/home/workspace/.cache',
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_PASSWORD: randomBytes(24).toString('hex'),
    OPENCODE_DISABLE_MODELS_FETCH: 'true',
  },
  stdio: 'ignore',
})
const base = 'http://127.0.0.1:4096'
const headers = { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64') }
const get = (path, auth = headers) => fetch(base + path, { headers: auth, signal: AbortSignal.timeout(2000) })
try {
  const health = v2 ? '/api/info' : '/global/health'
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Server exited before readiness: ' + server.exitCode)
    try {
      const response = await get(health)
      if (response.ok) {
        const info = await response.json()
        assert.equal(info.version, version)
        ready = true
        break
      }
    } catch (error) {
      if (error.code === 'ERR_ASSERTION') throw error
    }
    await setTimeout(500)
  }
  assert.equal(ready, true, 'Authenticated readiness deadline')
  assert.equal((await get(health, {})).status, 401, 'Missing Basic auth must fail')
  assert.equal((await get(health, { Authorization: 'Basic ' + Buffer.from('opencode:wrong').toString('base64') })).status, 401, 'Wrong Basic auth must fail')
  assert.equal(readFileSync('/workspace/.opencode/skills/arche-smoke/SKILL.md', 'utf8').includes('Smoke fixture only.'), true)
  assert.equal(readFileSync('/workspace/.git/info/exclude', 'utf8').includes('.opencode/skills/'), true)
  assert.equal(readFileSync('/workspace/AGENTS.md', 'utf8'), 'Isolated runtime smoke instructions.\\n')
  const configResponse = await get(v2 ? '/api/config?location%5Bdirectory%5D=%2Fworkspace' : '/config')
  assert.equal(configResponse.status, 200, await configResponse.clone().text())
  const config = await configResponse.json()
  assert.equal(JSON.stringify(config).includes('arche_smoke'), true, 'Injected project config must be loaded: ' + JSON.stringify(config))
  let skillDiscovered = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const skillsResponse = await get(v2 ? '/api/skill?location%5Bdirectory%5D=%2Fworkspace' : '/skill')
    assert.equal(skillsResponse.status, 200, await skillsResponse.clone().text())
    const skills = await skillsResponse.json()
    if (JSON.stringify(skills).includes('arche-smoke')) {
      skillDiscovered = true
      break
    }
    await setTimeout(500)
  }
  assert.equal(skillDiscovered, true, 'Project-local skill discovery deadline')
  const agentsResponse = await get(v2 ? '/api/agent?location%5Bdirectory%5D=%2Fworkspace' : '/agent')
  assert.equal(agentsResponse.status, 200)
  const agents = await agentsResponse.json()
  assert.equal(JSON.stringify(agents).includes('arche_smoke'), true, 'Configured agent must be available after location initialization')
  console.log(version + ': native auth (good/missing/wrong), password precedence, config, instructions and skills passed')
} finally {
  server.kill('SIGTERM')
  await Promise.race([new Promise(resolve => server.once('exit', resolve)), setTimeout(5000)])
  if (server.exitCode === null) server.kill('SIGKILL')
}
`,
  })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  assert.equal(result.error, undefined, `${image}: ${result.error?.message}`)
  assert.equal(result.status, 0, `${image}: runtime smoke failed`)
}

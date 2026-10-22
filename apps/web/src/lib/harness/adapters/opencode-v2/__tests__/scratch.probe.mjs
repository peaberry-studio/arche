// Run from apps/web with: ./node_modules/.bin/tsx src/lib/harness/adapters/opencode-v2/__tests__/scratch.probe.mjs
// Real native tools on 2.0.32: own scratch is prompt-free, other sessions are denied.
// Set SCRATCH_PROBE_HOST=desktop to exercise the packaged desktop tools path.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { OpenCode } from '@opencode/client'

const rendererModule = await import('@/lib/harness/adapters/opencode-v2/runtime-config')
const modelModule = await import('@/lib/harness/runtime-config')
const renderRuntimeConfig = rendererModule.renderRuntimeConfig ?? rendererModule.default.renderRuntimeConfig
const createRuntimeConfigModel = modelModule.createRuntimeConfigModel ?? modelModule.default.createRuntimeConfigModel

const SOURCE = {
  default_agent: 'assistant',
  agent: {
    assistant: { prompt: 'Follow CALL instructions.', tools: { task: true, read: true, write: true, edit: true, glob: true, grep: true, bash: true } },
    worker: { mode: 'subagent', description: 'Scratch probe worker', tools: { read: true, write: true, edit: true, glob: true, grep: true } },
    reader: { mode: 'all', description: 'Read-only probe agent', prompt: 'Follow CALL instructions.', tools: { read: true } },
  },
}
const ORIGINAL = 'original\n'
const root = await mkdtemp(join(process.cwd(), '.v2-scratch-probe-'))
const desktop = process.env.SCRATCH_PROBE_HOST === 'desktop'
const scratchRoot = join(root, ...(desktop ? ['os-temp', 'arche-scratch', 'vault-hash'] : ['scratch']))
const outside = join(root, 'outside')
const requests = []
const results = {}

const stub = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  const input = JSON.parse(body)
  requests.push(input)
  const last = input.messages.at(-1)
  const userText = JSON.stringify(input.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '')
  const call = last?.role === 'user' ? userText.match(/CALL:([A-Za-z0-9+/=]+)/) : null
  const delta = call
    ? (() => {
        const { name, args } = JSON.parse(Buffer.from(call[1], 'base64').toString('utf8'))
        return { tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
      })()
    : { role: 'assistant', content: 'done' }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  response.write(`data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
  response.end(`data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`)
})

async function waitFor(predicate, label) {
  const deadline = Date.now() + 25_000
  while (!await predicate()) {
    assert(Date.now() < deadline, `Timeout: ${label}`)
    await delay(50)
  }
}

try {
  await new Promise((done) => stub.listen(0, '127.0.0.1', done))
   const toolsSource = join(process.cwd(), '../../infra/workspace-image/arche-tools')
   const toolsDir = join(root, desktop ? 'bundle/bin/arche-tools' : 'image/opt/arche/arche-tools')
   await mkdir(toolsDir, { recursive: true })
   await cp(join(toolsSource, 'shared'), join(toolsDir, 'shared'), { recursive: true })
   await cp(join(toolsSource, 'package.json'), join(toolsDir, 'package.json'))
   const rendered = renderRuntimeConfig({ ...createRuntimeConfigModel({ ...SOURCE, mcp: { arche_tools: { type: 'local', command: ['node', join(toolsDir, 'server.js')], enabled: false } } }), scratch: { root: scratchRoot, workspaceRoot: join(root, 'workspace') } })
  assert.equal(rendered.ok, true, JSON.stringify(rendered.error))
  const config = rendered.data.config

   const workspace = join(root, 'workspace')
   await Promise.all(['workspace', 'home', 'config', 'data', 'cache', 'state', 'tmp', 'scratch/session-1', 'outside'].map((entry) => mkdir(join(root, entry), { recursive: true })))
   execFileSync('git', ['init', '-q', workspace])
  await writeFile(join(workspace, 'notes.txt'), ORIGINAL)
  const model = { capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 1000 }, cost: { input: 1, output: 2 } }
  await writeFile(join(workspace, 'opencode.json'), JSON.stringify({
    ...config,
    update: 'disable',
    model: 'fixture/fixture',
    snapshots: false,
    providers: { fixture: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${stub.address().port}/v1`, apiKey: randomBytes(16).toString('hex') }, models: { fixture: model } } },
  }))
  const credential = randomBytes(24).toString('hex')
  const child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: workspace,
    env: { PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache'), OPENCODE_SERVER_PASSWORD: credential, OPENCODE_LOG_LEVEL: 'error' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (chunk) => { log += chunk })
  child.stderr.on('data', (chunk) => { log += chunk })
  try {
    await waitFor(() => /http:\/\/127\.0\.0\.1:\d+/.test(log), 'server URL')
    const client = OpenCode.make({ baseUrl: log.match(/http:\/\/127\.0\.0\.1:\d+/)[0], headers: { Authorization: `Basic ${Buffer.from(`opencode:${credential}`).toString('base64')}` } })
    await waitFor(async () => { try { return (await client.server.info()).version === '2.0.32' } catch { return false } }, '2.0.32 readiness')
    if (config.plugins) await waitFor(async () => {
      const plugins = (await client.plugin.list({ location: { directory: workspace } })).data
      const guard = plugins.find((entry) => entry.id === 'arche.scratch-isolation')
      if (plugins.some((entry) => entry.state.status === 'failed')) throw new Error(JSON.stringify(plugins))
      return guard?.state.status === 'active'
    }, 'scratch guard activation')

    // Runs one tool call; any permission request is recorded and rejected so an
    // `ask` shows up as asked instead of hanging the probe.
    const newSession = (input = {}) => client.session.create({ agent: 'assistant', model: { providerID: 'fixture', id: 'fixture' }, location: { directory: workspace }, ...input })
    const callTool = async (tool, args, session) => {
      session ??= await newSession()
      const start = requests.length
      let asked = false
      await client.session.prompt({ sessionID: session.id, text: `CALL:${Buffer.from(JSON.stringify({ name: tool, args })).toString('base64')}` })
      await waitFor(async () => {
        const pending = (await client.permission.request.list({ location: { directory: workspace } })).data ?? []
        for (const request of pending.filter((entry) => entry.sessionID === session.id)) {
          asked = true
          await client.permission.reply({ sessionID: session.id, requestID: request.id, decision: 'reject' })
        }
        return requests.slice(start).some((input) => input.messages.at(-1)?.role === 'tool') || (asked && !(await client.session.active())[session.id])
      }, `${tool} result`)
      await waitFor(async () => Object.keys(await client.session.active()).length === 0, `${tool} idle`)
      const output = requests.slice(start).find((input) => input.messages.at(-1)?.role === 'tool')?.messages.at(-1).content ?? 'Permission rejected'
      return { asked, output: typeof output === 'string' ? output : JSON.stringify(output) }
    }
    const content = (path) => readFile(path, 'utf8').catch(() => null)
    const owner = await newSession()
    await client.session.update({ sessionID: owner.id, permissions: [{ action: 'external_directory', resource: '*', effect: 'allow' }] })
    await callTool('subagent', { agent: 'worker', description: 'scratch child', prompt: 'Hello' }, owner)
    const child = (await client.session.list({ directory: workspace, parentID: owner.id })).data[0]
    assert(child, 'the native subagent created a child session')
    assert.deepEqual(child.permissions, [{ action: 'external_directory', resource: '*', effect: 'allow' }], 'native children inherit parent rules')
    const peer = await newSession()
    const scratchFile = join(scratchRoot, owner.id, 'draft.md')

    await mkdir(join(scratchRoot, owner.id), { recursive: true })
    await writeFile(scratchFile, 'original\n')
    results.crossRead = await callTool('read', { path: scratchFile }, peer)
    assert.doesNotMatch(results.crossRead.output, /original/, 'another session cannot read the owner folder')
    assert.match(results.crossRead.output, /Scratch access is restricted/)
    results.crossWrite = await callTool('write', { path: scratchFile, content: 'intruder\n' }, peer)
    assert.equal(await content(scratchFile), 'original\n', 'another session cannot write the owner folder')
    assert.match(results.crossWrite.output, /Scratch access is restricted/)
    results.scratchWrite = await callTool('write', { path: scratchFile, content: 'draft v1\n' }, owner)
    assert.equal(await content(scratchFile), 'draft v1\n', `agents write in the scratch folder: ${JSON.stringify(results.scratchWrite)}`)
    assert.equal(results.scratchWrite.asked, false, 'without asking')

    results.scratchEdit = await callTool('edit', { path: scratchFile, oldString: 'v1', newString: 'v2' }, owner)
    assert.equal(await content(scratchFile), 'draft v2\n', 'agents edit in the scratch folder')
    assert.equal(results.scratchEdit.asked, false, 'without asking')

    results.scratchRead = await callTool('read', { path: scratchFile }, owner)
    assert.equal(results.scratchRead.asked, false, 'agents read the scratch folder without asking')
    assert.match(results.scratchRead.output, /draft v2/)
    await symlink(scratchRoot, join(root, 'scratch-alias'), 'dir')
    const aliasRead = await callTool('read', { path: join(root, 'scratch-alias', owner.id, 'draft.md') }, owner)
    assert.equal(aliasRead.asked, false, 'canonical temp-directory aliases stay prompt-free')
    assert.match(aliasRead.output, /draft v2/)

    results.kbWrite = await callTool('write', { path: join(workspace, 'notes.txt'), content: 'PWNED\n' })
    assert.equal(await content(join(workspace, 'notes.txt')), ORIGINAL, 'the Knowledge Base stays read-only')

    results.outsideWrite = await callTool('write', { path: join(outside, 'x.txt'), content: 'outside\n' })
    assert.equal(await content(join(outside, 'x.txt')), null, 'other directories stay guarded')

    for (const session of [owner, child, peer]) {
      const ownDir = join(scratchRoot, session.id)
      await mkdir(ownDir, { recursive: true })
      await writeFile(join(ownDir, 'own.txt'), 'OWN_CONTENT\n')
      for (const [tool, args, expected] of [
        ['read', { path: join(ownDir, 'own.txt') }, /OWN_CONTENT/],
        ['glob', { path: ownDir, pattern: '*.txt' }, /own.txt/],
        ['grep', { path: ownDir, pattern: 'OWN_CONTENT' }, /OWN_CONTENT/],
      ]) {
        const result = await callTool(tool, args, session)
        assert.equal(result.asked, false, `${tool} own scratch is prompt-free`)
        assert.match(result.output, expected)
      }
      const victim = session.id === owner.id ? child : owner
      const victimDir = join(scratchRoot, victim.id)
      await mkdir(victimDir, { recursive: true })
      await writeFile(join(victimDir, 'private.txt'), 'PRIVATE_CONTENT\n')
      await symlink(victimDir, join(ownDir, 'redirect'), 'dir')
      await symlink(workspace, join(ownDir, 'vault-redirect'), 'dir')
      await symlink(victimDir, join(workspace, `redirect-${session.id}`), 'dir')
      const missing = join(victimDir, 'created-by-attack.txt')
      await symlink(missing, join(ownDir, 'dangling-file'), 'file')
      await symlink(join(victimDir, 'missing-dir'), join(ownDir, 'dangling-dir'), 'dir')
      for (const [tool, args] of [
        ['read', { path: join(victimDir, 'private.txt') }],
        ['write', { path: join(victimDir, 'private.txt'), content: 'intruder\n' }],
        ['edit', { path: join(victimDir, 'private.txt'), oldString: 'PRIVATE', newString: 'intruder' }],
        ['glob', { path: victimDir, pattern: '*' }],
        ['grep', { path: victimDir, pattern: 'PRIVATE_CONTENT' }],
        ['read', { path: scratchRoot }],
        ['glob', { path: scratchRoot, pattern: '*' }],
        ['grep', { path: scratchRoot, pattern: 'PRIVATE_CONTENT' }],
        ['read', { path: join(ownDir, 'redirect/private.txt') }],
        ['write', { path: join(ownDir, 'vault-redirect/notes.txt'), content: 'intruder\n' }],
        ['write', { path: join(ownDir, 'dangling-file'), content: 'intruder\n' }],
        ['write', { path: join(ownDir, 'dangling-dir/new.txt'), content: 'intruder\n' }],
        ['read', { path: join(workspace, `redirect-${session.id}/private.txt`) }],
        ['glob', { path: join(workspace, `redirect-${session.id}`), pattern: '*' }],
        ['grep', { path: join(workspace, `redirect-${session.id}`), pattern: 'PRIVATE_CONTENT' }],
      ]) {
        const result = await callTool(tool, args, session)
        assert.equal(result.asked, false, `${tool} cross-session is denied, not approved`)
        assert.match(result.output, /Scratch access is restricted/, `${tool} cross-session denied: ${result.output}`)
        assert.equal(await content(join(victimDir, 'private.txt')), 'PRIVATE_CONTENT\n')
        assert.equal(await content(join(workspace, 'notes.txt')), ORIGINAL, 'scratch symlinks cannot bypass the vault guard')
        assert.equal(await content(missing), null, 'dangling links cannot create another session file')
        assert.equal(await content(join(victimDir, 'missing-dir/new.txt')), null, 'dangling directory links cannot create another session file')
        assert.doesNotMatch(result.output, /PRIVATE_CONTENT|private.txt/)
      }
      const ownWrite = join(ownDir, 'created.txt')
      await symlink(ownWrite, join(ownDir, 'own-dangling'), 'file')
      assert.equal((await callTool('write', { path: join(ownDir, 'own-dangling'), content: 'own v0\n' }, session)).asked, false)
      assert.equal(await content(ownWrite), 'own v0\n', 'own dangling file links remain writable without prompts')
      assert.equal((await callTool('write', { path: ownWrite, content: 'own v1\n' }, session)).asked, false)
      assert.equal(await content(ownWrite), 'own v1\n')
      assert.equal((await callTool('edit', { path: ownWrite, oldString: 'v1', newString: 'v2' }, session)).asked, false)
      assert.equal(await content(ownWrite), 'own v2\n')
    }
    const reader = await newSession({ agent: 'reader' })
    const readerFile = join(scratchRoot, reader.id, 'reader.md')
    results.readerWrite = await callTool('write', { path: readerFile, content: 'reader\n' }, reader)
    assert.equal(await content(readerFile), null, 'agents without write tools cannot write scratch files')
  } finally {
    child.kill('SIGTERM')
    if (child.exitCode === null) await Promise.race([new Promise((done) => child.once('exit', done)), delay(5_000).then(() => child.kill('SIGKILL'))])
  }
    console.log(JSON.stringify(results, null, 2).replaceAll(root, '<root>'))
    console.log(`PASS (${desktop ? 'desktop' : 'web'}): native parent/child/peer scratch isolation, prompt-free own tools, symlinks, and unchanged vault guards`)
} finally {
  stub.close()
  await rm(root, { recursive: true, force: true })
}

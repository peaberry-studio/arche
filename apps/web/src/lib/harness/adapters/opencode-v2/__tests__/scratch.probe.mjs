// Run from apps/web with: ./node_modules/.bin/tsx src/lib/harness/adapters/opencode-v2/__tests__/scratch.probe.mjs
// Checks the rendered scratch allowance against a real `opencode` 2.0.32: agents
// work freely in the session scratch folder while the Knowledge Base and every
// other directory keep their guards.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
    assistant: { prompt: 'Follow CALL instructions.', tools: { read: true, write: true, edit: true, bash: true } },
    reader: { mode: 'all', description: 'Read-only probe agent', prompt: 'Follow CALL instructions.', tools: { read: true } },
  },
}
const ORIGINAL = 'original\n'
const root = await mkdtemp(join(process.cwd(), '.v2-scratch-probe-'))
const scratchRoot = join(root, 'scratch')
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
  const rendered = renderRuntimeConfig({ ...createRuntimeConfigModel(SOURCE), scratch: { root: scratchRoot, workspaceRoot: join(root, 'workspace') } })
  assert.equal(rendered.ok, true, JSON.stringify(rendered.error))
  const config = rendered.data.config

  const workspace = join(root, 'workspace')
  await Promise.all(['workspace', 'home', 'config', 'data', 'cache', 'state', 'tmp', 'scratch/session-1', 'outside'].map((entry) => mkdir(join(root, entry), { recursive: true })))
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

    // Runs one tool call; any permission request is recorded and rejected so an
    // `ask` shows up as asked instead of hanging the probe.
    const callTool = async (tool, args, agent = 'assistant') => {
      const session = await client.session.create({ title: tool, agent, model: { providerID: 'fixture', id: 'fixture' }, location: { directory: workspace } })
      const start = requests.length
      let asked = false
      await client.session.prompt({ sessionID: session.id, text: `CALL:${Buffer.from(JSON.stringify({ name: tool, args })).toString('base64')}` })
      await waitFor(async () => {
        const pending = (await client.permission.request.list({ location: { directory: workspace } })).data ?? []
        for (const request of pending.filter((entry) => entry.sessionID === session.id)) {
          asked = true
          await client.permission.reply({ sessionID: session.id, requestID: request.id, reply: 'reject' })
        }
        return requests.slice(start).some((input) => input.messages.at(-1)?.role === 'tool')
      }, `${tool} result`)
      await waitFor(async () => Object.keys(await client.session.active()).length === 0, `${tool} idle`)
      const output = requests.slice(start).find((input) => input.messages.at(-1)?.role === 'tool').messages.at(-1).content
      return { asked, output: typeof output === 'string' ? output : JSON.stringify(output) }
    }
    const content = (path) => readFile(path, 'utf8').catch(() => null)
    const scratchFile = join(scratchRoot, 'session-1', 'draft.md')

    results.scratchWrite = await callTool('write', { path: scratchFile, content: 'draft v1\n' })
    assert.equal(await content(scratchFile), 'draft v1\n', `agents write in the scratch folder: ${JSON.stringify(results.scratchWrite)}`)
    assert.equal(results.scratchWrite.asked, false, 'without asking')

    results.scratchEdit = await callTool('edit', { path: scratchFile, oldString: 'v1', newString: 'v2' })
    assert.equal(await content(scratchFile), 'draft v2\n', 'agents edit in the scratch folder')
    assert.equal(results.scratchEdit.asked, false, 'without asking')

    results.scratchRead = await callTool('read', { path: scratchFile })
    assert.equal(results.scratchRead.asked, false, 'agents read the scratch folder without asking')
    assert.match(results.scratchRead.output, /draft v2/)

    results.kbWrite = await callTool('write', { path: join(workspace, 'notes.txt'), content: 'PWNED\n' })
    assert.equal(await content(join(workspace, 'notes.txt')), ORIGINAL, 'the Knowledge Base stays read-only')

    results.outsideWrite = await callTool('write', { path: join(outside, 'x.txt'), content: 'outside\n' })
    assert.equal(await content(join(outside, 'x.txt')), null, 'other directories stay guarded')

    results.readerWrite = await callTool('write', { path: join(scratchRoot, 'session-1', 'reader.md'), content: 'reader\n' }, 'reader')
    assert.equal(await content(join(scratchRoot, 'session-1', 'reader.md')), null, 'agents without write tools cannot write scratch files')
  } finally {
    child.kill('SIGTERM')
    if (child.exitCode === null) await Promise.race([new Promise((done) => child.once('exit', done)), delay(5_000).then(() => child.kill('SIGKILL'))])
  }
  console.log(JSON.stringify(results, null, 2))
} finally {
  stub.close()
  await rm(root, { recursive: true, force: true })
}

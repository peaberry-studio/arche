import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { OpenCode } from '@opencode/client'

// Credential-free OpenAI-compatible fake provider shared by the v1 and v2
// reconnect probes. It scripts one conversation: reasoning + text (paused
// mid-text), a queued prompt that reads a file behind a permission ask, then
// delegates to a subagent whose reply is paused mid-text, then a final reply.
export function createReconnectStub({ readPath }) {
  const barriers = { text: Promise.withResolvers(), child: Promise.withResolvers() }
  const reached = { text: Promise.withResolvers(), child: Promise.withResolvers() }
  const requests = []
  const schemas = {}

  function script(input) {
    const messages = input.messages
    const system = messages.filter((message) => message.role === 'system').map((message) => JSON.stringify(message.content)).join(' ')
    if (/title/i.test(system) && !/PROBE_AGENT/.test(system)) return { kind: 'title', chunks: [{ role: 'assistant', content: 'Probe title' }] }
    const lastUser = messages.findLastIndex((message) => message.role === 'user')
    const user = JSON.stringify(messages[lastUser]?.content ?? '')
    const results = messages.slice(lastUser).filter((message) => message.role === 'tool').length
    const tool = (name, args) => [
      { tool_calls: [{ index: 0, id: `call_${name}_${results}`, type: 'function', function: { name, arguments: '' } }] },
      { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] },
    ]
    if (user.includes('CHILD_PROBE')) return { kind: 'child', chunks: [{ role: 'assistant', content: 'Child ' }, { content: 'done' }], barrier: 'child' }
    if (user.includes('QUEUED_PROBE')) {
      const tools = Object.fromEntries((input.tools ?? []).map((entry) => [entry.function.name, entry.function.parameters]))
      if (results === 0) {
        const key = Object.keys(tools.read?.properties ?? {}).find((name) => /path/i.test(name)) ?? 'path'
        return { kind: 'read', chunks: tool('read', { [key]: readPath }), finish: 'tool_calls' }
      }
      if (results === 1) {
        const name = tools.subagent ? 'subagent' : 'task'
        const schema = tools[name] ?? { properties: {}, required: [] }
        schemas[name] = schema
        const args = Object.fromEntries((schema.required ?? Object.keys(schema.properties ?? {})).map((key) => [key,
          /prompt/i.test(key) ? 'CHILD_PROBE' : /agent|type/i.test(key) ? 'child' : 'Child probe']))
        return { kind: 'subagent', chunks: tool(name, args), finish: 'tool_calls' }
      }
      return { kind: 'final', chunks: [{ role: 'assistant', content: 'All ' }, { content: 'done' }] }
    }
    if (user.includes('MIXED_PROBE')) {
      return { kind: 'mixed', chunks: [{ reasoning_content: 'Fixture ' }, { reasoning_content: 'reasoning' }, { role: 'assistant', content: 'Hello ' }, { content: 'fixture' }], barrier: 'text', pauseAfter: 2 }
    }
    return { kind: 'other', chunks: [{ role: 'assistant', content: 'ok' }] }
  }

  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    const plan = script(input)
    requests.push({ path: request.url, kind: plan.kind, model: input.model, tools: input.tools?.map((entry) => entry.function.name) })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const write = (delta, finish = null, usage) => response.write(`data: ${JSON.stringify({ id: 'chatcmpl-probe', object: 'chat.completion.chunk', created: 1, model: input.model,
      choices: [{ index: 0, delta, finish_reason: finish }], ...(usage && { usage }) })}\n\n`)
    for (const [index, delta] of plan.chunks.entries()) {
      write(delta)
      await delay(20)
      if (plan.barrier && index === (plan.pauseAfter ?? 0)) {
        reached[plan.barrier].resolve()
        await barriers[plan.barrier].promise
      }
    }
    write({}, plan.finish ?? 'stop', { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 })
    response.end('data: [DONE]\n\n')
  })

  return {
    server, requests, schemas, reached,
    release(name) { barriers[name].resolve() },
    releaseAll() { for (const barrier of Object.values(barriers)) barrier.resolve() },
    async listen(host) {
      await new Promise((resolve) => server.listen(0, host, resolve))
      return server.address().port
    },
    async close() {
      this.releaseAll()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

// Waits until no new event has arrived for `quietMs`, so a snapshot read at
// that point corresponds to an exact prefix of the continuous event log.
export async function quiesce(events, quietMs = 400, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let count = events.length
  let since = Date.now()
  while (Date.now() - since < quietMs) {
    if (Date.now() > deadline) throw new Error('Timeout: quiescence')
    await delay(25)
    if (events.length !== count) { count = events.length; since = Date.now() }
  }
  return count
}

export function within(promise, label, timeoutMs = 30_000) {
  return Promise.race([promise, delay(timeoutMs).then(() => { throw new Error(`Timeout: ${label}`) })])
}

export async function waitFor(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${label}`)
    await delay(50)
  }
}

// Starts the installed `opencode` 2.x binary as a foreground loopback serve
// with random Basic auth, repository-local scratch HOME/XDG directories, a
// whitelisted environment and only the fake provider. Never touches the
// host's shared OpenCode service. `stop()` kills the process and removes all
// scratch.
export async function startReconnectServe() {
  const root = await mkdtemp(join(process.cwd(), '.v2-reconnect-'))
  const workspace = join(root, 'workspace')
  const stub = createReconnectStub({ readPath: join(workspace, 'sample.txt') })
  let processHandle
  const stop = async () => {
    stub.releaseAll()
    processHandle?.kill('SIGTERM')
    if (processHandle && processHandle.exitCode === null) await Promise.race([new Promise((resolve) => processHandle.once('exit', resolve)), delay(5_000).then(() => processHandle.kill('SIGKILL'))])
    await stub.close()
    await rm(root, { recursive: true, force: true })
  }
  try {
    await Promise.all(['workspace', 'home', 'config', 'data', 'cache', 'state', 'tmp'].map((directory) => mkdir(join(root, directory))))
    await writeFile(join(workspace, 'sample.txt'), 'fixture-only\n')
    const stubPort = await stub.listen('127.0.0.1')
    const model = { capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 1000 }, cost: { input: 1, output: 2 } }
    await writeFile(join(workspace, 'opencode.json'), JSON.stringify({
      model: 'fixture/fixture', default_agent: 'probe', snapshots: false,
      providers: { fixture: { name: 'Fixture', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${stubPort}/v1`, apiKey: randomBytes(16).toString('hex') }, models: { fixture: model } } },
      agents: {
        probe: { mode: 'primary', system: 'PROBE_AGENT. Answer briefly.', permissions: [{ action: '*', resource: '*', effect: 'deny' }, { action: 'read', resource: '*', effect: 'ask' }, { action: 'subagent', resource: '*', effect: 'allow' }] },
        child: { mode: 'subagent', description: 'Probe child', system: 'PROBE_AGENT child. Answer briefly.', permissions: [{ action: '*', resource: '*', effect: 'deny' }] },
      },
      policies: [{ action: 'provider.use', resource: '*', effect: 'deny' }, { action: 'provider.use', resource: 'fixture', effect: 'allow' }],
    }))
    const password = randomBytes(24).toString('hex')
    processHandle = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
      cwd: workspace,
      env: { PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache'), OPENCODE_SERVER_PASSWORD: password, OPENCODE_LOG_LEVEL: 'error' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    processHandle.stdout.on('data', (chunk) => { log += chunk })
    processHandle.stderr.on('data', (chunk) => { log += chunk })
    await waitFor(() => /http:\/\/127\.0\.0\.1:\d+/.test(log), 'server URL')
    const baseUrl = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0]
    const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
    const client = OpenCode.make({ baseUrl, headers: { Authorization: authHeader } })
    let version
    await waitFor(async () => { try { version = (await client.server.info()).version; return true } catch { return false } }, 'readiness')
    return { root, workspace, stub, baseUrl, authHeader, client, version, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

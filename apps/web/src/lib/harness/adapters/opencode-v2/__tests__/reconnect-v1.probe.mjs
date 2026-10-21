import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { createReconnectStub, quiesce, waitFor, within } from './probe-harness.mjs'

// Baseline for the v2 reconnect parity contract: the same scripted
// conversation against the pinned v1 image (OpenCode 1.18.18) in a disposable
// podman container. Prints the captured events and cut-point snapshots.
const IMAGE = process.env.OPENCODE_V1_PROBE_IMAGE ?? 'ghcr.io/anomalyco/opencode:1.18.18'
const root = await mkdtemp(join(process.cwd(), '.v1-reconnect-'))
const workspace = join(root, 'workspace')
const stub = createReconnectStub({ readPath: '/workspace/sample.txt' })
const subscriber = new AbortController()
const events = []
const cuts = []
const name = `arche-v1-reconnect-${randomBytes(4).toString('hex')}`
let started = false
let subscription

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`${command} ${args[0]} exited ${code}: ${output.slice(0, 500)}`)))
  })
}

try {
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'sample.txt'), 'fixture-only\n')
  const stubPort = await stub.listen('127.0.0.1')
  const model = { name: 'Fixture', tool_call: true, reasoning: true, limit: { context: 32000, output: 1000 }, cost: { input: 1, output: 2 } }
  await writeFile(join(workspace, 'opencode.json'), JSON.stringify({
    $schema: 'https://opencode.ai/config.json', model: 'fixture/fixture', small_model: 'fixture/fixture', default_agent: 'probe',
    enabled_providers: ['fixture'], share: 'disabled', autoupdate: false, snapshot: false,
    provider: { fixture: { npm: '@ai-sdk/openai-compatible', name: 'Fixture', options: { baseURL: `http://host.containers.internal:${stubPort}/v1`, apiKey: randomBytes(16).toString('hex') }, models: { fixture: model } } },
    agent: {
      probe: { mode: 'primary', prompt: 'PROBE_AGENT. Answer briefly.', permission: { '*': 'deny', read: 'ask', task: 'allow' } },
      child: { mode: 'subagent', description: 'Probe child', prompt: 'PROBE_AGENT child. Answer briefly.', permission: { '*': 'deny' } },
    },
  }))
  const password = randomBytes(24).toString('hex')
  await run('podman', ['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::4096', '-v', `${workspace}:/workspace`, '-w', '/workspace',
    '-e', 'OPENCODE_SERVER_PASSWORD', '-e', 'OPENCODE_DISABLE_MODELS_FETCH=1', '-e', 'OPENCODE_DISABLE_AUTOUPDATE=1',
    '-e', 'OPENCODE_DISABLE_LSP_DOWNLOAD=1', '-e', 'OPENCODE_DISABLE_DEFAULT_PLUGINS=1', IMAGE, 'serve', '--hostname', '0.0.0.0', '--port', '4096'], { OPENCODE_SERVER_PASSWORD: password })
  started = true
  const baseUrl = `http://${(await run('podman', ['port', name, '4096'])).trim().split('\n')[0]}`
  const headers = { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, 'Content-Type': 'application/json' }
  const api = async (path, init = {}) => {
    const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(10_000), ...init, headers })
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status}`)
    return response.status === 204 ? undefined : response.json()
  }
  let lastError
  await waitFor(async () => { try { await api('/global/health'); return true } catch (error) { lastError = error.cause ?? error; return false } }, 'v1 readiness', 60_000)
    .catch(async (error) => { throw new Error(`${error.message}: ${lastError?.message}; ${(await run('podman', ['logs', name]).catch((e) => e.message)).slice(-800)}`) })
  const version = (await api('/global/health')).version
  subscription = (async () => {
    const response = await fetch(`${baseUrl}/event`, { headers: { ...headers, Accept: 'text/event-stream' }, signal: subscriber.signal })
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (data) events.push(JSON.parse(data))
      }
    }
  })().catch(() => undefined)
  await waitFor(() => events.some((event) => event.type === 'server.connected'), 'v1 SSE')

  const snapshot = async (label) => {
    const eventIndex = await quiesce(events)
    const sessions = await api('/session')
    const messages = {}
    for (const session of sessions) messages[session.id] = await api(`/session/${session.id}/message`)
    const result = { label, eventIndex, sessions, messages, permissions: await api('/permission'), status: await api('/session/status') }
    if (events.length !== eventIndex) throw new Error(`Snapshot ${label} raced live events`)
    cuts.push(result)
  }

  const session = await api('/session', { method: 'POST', body: JSON.stringify({ title: 'reconnect' }) })
  const prompt = (text) => api(`/session/${session.id}/prompt_async`, { method: 'POST', body: JSON.stringify({ agent: 'probe', model: { providerID: 'fixture', modelID: 'fixture' }, parts: [{ type: 'text', text }] }) })
  await prompt('MIXED_PROBE')
  await within(stub.reached.text.promise, 'text barrier')
  await snapshot('mid-text')
  await prompt('QUEUED_PROBE')
  await snapshot('queued')
  stub.release('text')
  await waitFor(async () => (await api('/permission')).length > 0, 'permission ask')
  await snapshot('mid-tool')
  const [ask] = await api('/permission')
  await api(`/permission/${ask.id}/reply`, { method: 'POST', body: JSON.stringify({ reply: 'once' }) })
  await within(stub.reached.child.promise, 'child barrier')
  await snapshot('mid-child')
  stub.release('child')
  await waitFor(async () => Object.keys(await api('/session/status')).length === 0 && stub.requests.some((request) => request.kind === 'final'), 'v1 idle', 60_000)
  await snapshot('end')
  const serialized = JSON.stringify({ runtime: 'opencode-v1', version, requests: stub.requests, schemas: stub.schemas, events, cuts }, null, 2)
    .replaceAll(workspace, '/workspace').replaceAll(root, '/isolated')
  console.log(serialized)
} catch (error) {
  console.error(error, JSON.stringify({ requests: stub.requests, types: events.map((event) => event.type), failures: events.filter((event) => /failed/.test(event.type)).map((event) => event.data) }))
  process.exitCode = 1
} finally {
  subscriber.abort()
  stub.releaseAll()
  await subscription
  if (started) await run('podman', ['rm', '-f', name]).catch(() => undefined)
  await stub.close()
  await delay(10)
  await rm(root, { recursive: true, force: true })
}

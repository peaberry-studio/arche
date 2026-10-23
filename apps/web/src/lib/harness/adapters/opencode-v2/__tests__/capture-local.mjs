import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { OpenCode } from '@opencode/client'

const root = await mkdtemp(join(process.cwd(), '.task55-capture-'))
const workspace = join(root, 'workspace')
const events = []
const observations = {}
const snapshots = {}
const requests = []
const releaseSlow = new AbortController()
const subscriber = new AbortController()
const reconnectSubscriber = new AbortController()
const textBarriers = [Promise.withResolvers(), Promise.withResolvers()]
let processHandle
let subscription
let reconnectSubscription
const stub = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  const input = JSON.parse(body)
  const user = input.messages.filter((message) => message.role === 'user').map((message) => JSON.stringify(message.content)).join(' ')
  const hasTool = input.messages.some((message) => message.role === 'tool')
  const tool = user.includes('TOOL_PROBE') && !hasTool
  requests.push({ path: request.url, model: input.model, toolNames: input.tools?.map((entry) => entry.function.name), slow: user.includes('SLOW_PROBE') })
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  if (user.includes('SLOW_PROBE')) {
    response.write(': waiting\n\n')
    await delay(30_000, undefined, { signal: releaseSlow.signal }).catch(() => undefined)
  }
  const chunks = tool ? [
    { tool_calls: [{ index: 0, id: 'call_probe', type: 'function', function: { name: 'read', arguments: '' } }] },
    { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ path: join(workspace, 'sample.txt') }) } }] },
  ] : [...(user.includes('MIXED_PROBE') ? [{ reasoning_content: 'Fixture reasoning' }] : []), { role: 'assistant', content: 'Hello ' }, { content: 'fixture' }]
  for (const [index, delta] of [...chunks, {}].entries()) {
    response.write(`data: ${JSON.stringify({ id: 'chatcmpl-probe', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    if (user.includes('OVERLAP_PROBE') && textBarriers[index]) await textBarriers[index].promise
    await delay(20)
  }
  response.end(`data: ${JSON.stringify({ id: 'chatcmpl-probe', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } })}\n\ndata: [DONE]\n\n`)
})

try {
  await Promise.all(['workspace', 'home', 'config', 'data', 'cache', 'state', 'tmp'].map((directory) => mkdir(join(root, directory))))
  await writeFile(join(workspace, 'sample.txt'), 'fixture-only\n')
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
  const model = { capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 1000 }, cost: { input: 1, output: 2 } }
  const agent = { mode: 'primary', system: 'Use read when TOOL_PROBE is requested, otherwise answer briefly.', permissions: [{ action: '*', resource: '*', effect: 'deny' }, { action: 'read', resource: '*', effect: 'ask' }] }
  await writeFile(join(workspace, 'opencode.json'), JSON.stringify({
    model: 'fixture/fixture', default_agent: 'probe', snapshots: false,
    providers: { fixture: { name: 'Fixture', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${stub.address().port}/v1`, apiKey: randomBytes(16).toString('hex') }, models: { fixture: model, alternate: model } } },
    agents: { probe: agent, alternate: agent },
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
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 25_000
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error(`Timeout: ${label}`)
      await delay(50)
    }
  }
  await waitFor(() => /http:\/\/127\.0\.0\.1:\d+/.test(log), 'server URL')
  const baseUrl = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0]
  const client = OpenCode.make({ baseUrl, headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } })
  await waitFor(async () => { try { observations.version = (await client.server.info()).version; return true } catch { return false } }, 'readiness')
  assert.equal(observations.version, '2.0.32')
  const openapi = await (await fetch(`${baseUrl}/openapi.json`, { headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } })).json()
  observations.eventParameters = openapi.paths['/api/event'].get.parameters ?? []
  const readLog = async (sessionID, after) => {
    const items = []
    for await (const item of client.session.log({ sessionID, follow: false, after }, { signal: AbortSignal.timeout(5000) })) items.push(item)
    return items
  }
  subscription = (async () => { for await (const event of client.event.subscribe({ signal: subscriber.signal })) events.push(event) })()
  await waitFor(() => events.some((event) => event.type === 'server.connected'), 'SSE')
  const create = (title, parentID) => client.session.create({ title, parentID, agent: 'probe', model: { providerID: 'fixture', id: 'fixture' }, location: { directory: workspace } })
  for (const label of ['text', 'tool', 'mixed']) {
    const session = await create(label)
    const prompt = await client.session.prompt({ sessionID: session.id, text: `${label.toUpperCase()}_PROBE`, ...(label === 'text' && { id: 'msg_fixture_text' }) })
    if (label === 'text') observations.callerIdPrompt = prompt
    await waitFor(async () => {
      const ask = events.find((event) => event.type === 'permission.asked' && event.data.sessionID === session.id)
      if (ask && !observations.permission) {
        observations.permission = await client.permission.request.list()
        observations.permissionActive = await client.session.active()
        await client.permission.reply({ sessionID: session.id, requestID: ask.data.id, decision: 'once' })
      }
      return events.some((event) => event.type === 'session.execution.succeeded' && event.data.sessionID === session.id)
    }, label)
    snapshots[label] = { session: await client.session.get({ sessionID: session.id }), messages: await client.message.list({ sessionID: session.id, order: 'asc' }) }
  }
  const overlap = await create('unfinished-overlap')
  await client.session.prompt({ sessionID: overlap.id, text: 'OVERLAP_PROBE' })
  const textDeltas = () => events.filter((event) => event.type === 'session.text.delta' && event.data.sessionID === overlap.id)
  await waitFor(() => textDeltas().length === 1, 'first overlap delta')
  const firstMessages = await client.message.list({ sessionID: overlap.id, order: 'asc' })
  const firstLog = await readLog(overlap.id)
  const reconnectEvents = []
  const reconnect = OpenCode.make({ baseUrl, headers: {
    Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
    'Last-Event-ID': textDeltas()[0].id,
  } })
  reconnectSubscription = (async () => { for await (const event of reconnect.event.subscribe({ signal: reconnectSubscriber.signal })) reconnectEvents.push(event) })()
  await waitFor(() => reconnectEvents.some((event) => event.type === 'server.connected'), 'reconnected SSE')
  textBarriers[0].resolve()
  await waitFor(() => textDeltas().length === 2, 'second overlap delta')
  await waitFor(() => reconnectEvents.some((event) => event.type === 'session.text.delta'), 'reconnected delta')
  const secondMessages = await client.message.list({ sessionID: overlap.id, order: 'asc' })
  const secondLog = await readLog(overlap.id)
  const assistant = (page) => page.data.find((message) => message.type === 'assistant')
  assert.equal(assistant(firstMessages).time.completed, undefined)
  assert.equal(assistant(firstMessages).content[0].text, '')
  assert.equal(assistant(secondMessages).content[0].text, '')
  assert.equal(textDeltas().map((event) => event.data.delta).join(''), 'Hello fixture')
  assert.deepEqual(reconnectEvents.filter((event) => event.type === 'session.text.delta').map((event) => event.data.delta), ['fixture'])
  assert.deepEqual(firstLog, secondLog, 'durable log and sync marker do not advance with the second text delta')
  assert(!secondLog.some((item) => item.type === 'session.text.delta'))
  assert.equal(secondLog.length, 1)
  assert.equal(secondLog[0].type, 'log.synced')
  const lastSeq = secondLog[0].seq
  assert(Number.isInteger(lastSeq))
  const afterLog = await readLog(overlap.id, lastSeq)
  assert.deepEqual(afterLog, secondLog)
  observations.unfinishedOverlap = { firstMessages, secondMessages, firstLog, secondLog, afterLog, deltas: textDeltas(), reconnectEvents: [...reconnectEvents] }
  reconnectSubscriber.abort()
  await reconnectSubscription
  textBarriers[1].resolve()
  await waitFor(() => events.some((event) => event.type === 'session.execution.succeeded' && event.data.sessionID === overlap.id), 'overlap completion')
  const completeLog = await readLog(overlap.id)
  const fromZero = await readLog(overlap.id, 0)
  const fromOne = await readLog(overlap.id, 1)
  const fromEarlierSync = await readLog(overlap.id, lastSeq)
  assert.deepEqual(fromZero, completeLog)
  assert.deepEqual(fromOne, completeLog)
  assert.deepEqual(fromEarlierSync, completeLog)
  assert.equal(completeLog.length, 1)
  assert.equal(completeLog[0].type, 'log.synced')
  assert(completeLog[0].seq > lastSeq)
  const enqueued = events.find((item) => item.type === 'session.inbox.enqueued' && item.data.sessionID === overlap.id)
  const delivered = events.find((item) => item.type === 'session.inbox.delivered' && item.data.sessionID === overlap.id)
  assert(enqueued && delivered)
  assert(enqueued.data.item.payload.text === 'OVERLAP_PROBE')
  assert.equal(delivered.data.inboxID, enqueued.data.inboxID)
  observations.completedReplay = { completeLog, fromZero, fromOne, fromEarlierSync, enqueued, delivered }
  const selected = await create('selection')
  await client.session.switchAgent({ sessionID: selected.id, agent: 'alternate' })
  await client.session.switchModel({ sessionID: selected.id, model: { providerID: 'fixture', id: 'alternate' } })
  observations.selection = await client.session.get({ sessionID: selected.id })
  observations.noReply = await client.session.prompt({ sessionID: selected.id, id: 'msg_fixture_caller', text: 'NO_REPLY_PROBE', resume: false })
  await delay(300)
  observations.noReplyActive = await client.session.active()
  observations.noReplyMessages = await client.message.list({ sessionID: selected.id, order: 'asc' })
  observations.noReplyInbox = await client.session.inbox.list({ sessionID: selected.id })
  const parent = await create('active-parent')
  const child = await create('active-child', parent.id)
  await client.session.prompt({ sessionID: parent.id, text: 'SLOW_PROBE' })
  await client.session.prompt({ sessionID: child.id, text: 'SLOW_PROBE' })
  await waitFor(async () => { const active = await client.session.active(); return active[parent.id] && active[child.id] }, 'active parent and child')
  observations.family = { parentID: parent.id, childID: child.id, active: await client.session.active() }
  await client.session.background({ sessionID: child.id })
  observations.family.background = await client.session.active()
  observations.family.interruptParent = await client.session.interrupt({ sessionID: parent.id, resume: false })
  observations.family.afterParent = await client.session.active()
  observations.family.interruptChild = await client.session.interrupt({ sessionID: child.id, resume: false })
  await waitFor(async () => { const active = await client.session.active(); return !active[parent.id] && !active[child.id] }, 'family idle')
  observations.family.idle = await client.session.active()
  await delay(100)
  const serialized = JSON.stringify({ observations, snapshots, events, requests }, null, 2).replaceAll(workspace, '/workspace').replaceAll(root, '/isolated').replaceAll(resolve(process.cwd(), '../..'), '/repository')
  console.log(serialized)
} finally {
  subscriber.abort()
  reconnectSubscriber.abort()
  for (const barrier of textBarriers) barrier.resolve()
  await subscription?.catch(() => undefined)
  await reconnectSubscription?.catch(() => undefined)
  releaseSlow.abort()
  processHandle?.kill('SIGTERM')
  if (processHandle && processHandle.exitCode === null) await Promise.race([new Promise((resolve) => processHandle.once('exit', resolve)), delay(5_000).then(() => processHandle.kill('SIGKILL'))])
  stub.closeAllConnections()
  await new Promise((resolve) => stub.close(resolve))
  await rm(root, { recursive: true, force: true })
}

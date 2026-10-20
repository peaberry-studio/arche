import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

import { OpenCode } from '@opencode/client'

const root = await mkdtemp(join(process.cwd(), '.v2-execution-probe-'))
const workspace = join(root, 'workspace')
const requests = []
const release = new AbortController()
let child
const stub = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  const input = JSON.parse(body)
  requests.push(input)
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  if (JSON.stringify(input.messages).includes('SLOW_PROBE')) {
    response.write(': waiting\n\n')
    await delay(30_000, undefined, { signal: release.signal }).catch(() => undefined)
  }
  response.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Fixture complete' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } })}\n\ndata: [DONE]\n\n`)
})

const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 25_000
  while (!await predicate()) {
    assert(Date.now() < deadline, `Timeout: ${label}`)
    await delay(50)
  }
}

try {
  await Promise.all(['workspace', 'home', 'config', 'data', 'cache', 'state', 'tmp'].map((directory) => mkdir(join(root, directory))))
  await mkdir(join(workspace, 'context'))
  await writeFile(join(workspace, 'context', 'note ü.txt'), 'WORKSPACE_ATTACHMENT_CONTENT\n')
  const pngChunk = (type, data) => {
    const content = Buffer.concat([Buffer.from(type), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(content))
    return Buffer.concat([length, content, checksum])
  }
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', Buffer.from('00000001000000010802000000', 'hex')), pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))), pngChunk('IEND', Buffer.alloc(0))]).toString('base64')
  await writeFile(join(workspace, 'pixel.png'), Buffer.from(png, 'base64'))
  await new Promise((done) => stub.listen(0, '127.0.0.1', done))
  await writeFile(join(workspace, 'opencode.json'), JSON.stringify({
    update: 'disable', model: 'fixture/fixture', default_agent: 'probe', snapshots: false,
    providers: { fixture: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${stub.address().port}/v1`, apiKey: randomBytes(16).toString('hex') }, models: { fixture: { capabilities: { tools: true, input: ['text', 'image'], output: ['text'] }, limit: { context: 32000, output: 1000 }, cost: { input: 1, output: 2 } } } } },
    agents: { probe: { mode: 'primary', system: 'Answer briefly.', permissions: [{ action: '*', resource: '*', effect: 'deny' }] } },
    policies: [{ action: 'provider.use', resource: '*', effect: 'deny' }, { action: 'provider.use', resource: 'fixture', effect: 'allow' }],
  }))
  const password = randomBytes(24).toString('hex')
  child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: workspace,
    env: { PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache'), OPENCODE_SERVER_PASSWORD: password, OPENCODE_LOG_LEVEL: 'error' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (chunk) => { log += chunk })
  child.stderr.on('data', (chunk) => { log += chunk })
  await waitFor(() => /http:\/\/127\.0\.0\.1:\d+/.test(log), 'server URL')
  const client = OpenCode.make({ baseUrl: log.match(/http:\/\/127\.0\.0\.1:\d+/)[0], headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } })
  await waitFor(async () => { try { return (await client.server.info()).version === '2.0.32' } catch { return false } }, '2.0.32 readiness')
  const create = (title, parentID) => client.session.create({ title, parentID, agent: 'probe', model: { providerID: 'fixture', id: 'fixture' }, location: { directory: workspace } })
  const files = [
    { uri: pathToFileURL(join(workspace, 'context', 'note ü.txt')).href, name: 'note ü.txt' },
    { uri: pathToFileURL(join(workspace, 'context')).href, name: 'context' },
    { uri: pathToFileURL(join(workspace, 'pixel.png')).href, name: 'pixel.png' },
    { uri: `data:image/png;base64,${png}`, name: 'inline.png' },
  ]
  const attachment = await create('attachments')
  await client.session.prompt({ sessionID: attachment.id, id: 'msg_attachment_probe', text: 'ATTACHMENT_PROBE', files })
  await waitFor(async () => (await client.message.list({ sessionID: attachment.id })).data.some((message) => message.type === 'assistant' && message.time.completed), 'attachment completion')
  const messages = (await client.message.list({ sessionID: attachment.id, order: 'asc' })).data
  const user = messages.find((message) => message.id === 'msg_attachment_probe')
  assert.equal(user?.type, 'user')
  console.log('ATTACHMENTS', JSON.stringify(user.files.map((file) => ({ name: file.name, mime: file.mime, source: file.source, bytes: Buffer.from(file.data, 'base64').length }))).replaceAll(workspace, '/workspace'))
  assert.deepEqual(user.files.map((file) => file.name), files.map((file) => file.name))
  assert.deepEqual(user.files.slice(0, 3).map((file) => file.source), files.slice(0, 3).map((file) => ({ type: 'uri', uri: file.uri })))
  assert.equal(user.files[3].source.type, 'inline')
  assert.equal(user.files[3].mime, 'image/png')
  assert.equal(user.files[3].data, png)
  const providerInput = JSON.stringify(requests[0].messages)
  assert(providerInput.includes('WORKSPACE_ATTACHMENT_CONTENT'), 'text attachment contents reach provider')
  assert.equal(requests[0].messages.flatMap((message) => Array.isArray(message.content) ? message.content : []).filter((part) => part.type === 'image_url' && part.image_url.url === `data:image/png;base64,${png}`).length, 2, 'both workspace and inline PNG bytes reach provider')
  console.log('PASS: workspace text/directory/PNG preserve URI/name in history; inline PNG preserves bytes/MIME/name; text/image contents reach the fixture provider')

  const parent = await create('parent')
  const nested = await create('nested', parent.id)
  const grandchild = await create('grandchild', nested.id)
  for (const session of [parent, nested, grandchild]) await client.session.prompt({ sessionID: session.id, text: 'SLOW_PROBE' })
  await waitFor(async () => { const active = await client.session.active(); return [parent, nested, grandchild].every((session) => active[session.id]?.type === 'running') }, 'nested family active')
  await client.session.background({ sessionID: grandchild.id })
  assert((await client.session.active())[grandchild.id], 'background grandchild remains active')
  const queued = await client.session.prompt({ sessionID: parent.id, id: 'msg_queue_probe', text: 'QUEUED_PROBE', delivery: 'queue', resume: false })
  assert((await client.session.inbox.list({ sessionID: parent.id })).some((item) => item.id === queued.id))
  for (const session of [grandchild, nested, parent]) await client.session.interrupt({ sessionID: session.id, resume: false })
  await waitFor(async () => Object.keys(await client.session.active()).length === 0, 'foreground family interrupted')
  const pending = await client.session.inbox.list({ sessionID: parent.id })
  assert(pending.some((item) => item.id === queued.id), 'interrupt does not drain queued input')
  await client.session.inbox.cancel({ sessionID: parent.id, inboxID: queued.id })
  assert.deepEqual(await client.session.inbox.list({ sessionID: parent.id }), [])
  assert(!(await client.message.list({ sessionID: parent.id })).data.some((message) => message.id === queued.id))
  assert(!JSON.stringify(requests).includes('QUEUED_PROBE'), 'cancelled queue never reached provider')
  console.log('PASS: nested/background foreground activity visible; interrupt leaves queued input despite empty active map; explicit inbox cancel removes it without delivery')
  console.log('UNVERIFIED: retry/tool-created/late-child races and atomic idle/queue/family discovery; empty active map is NOT production family-idle acceptance')
} finally {
  release.abort()
  child?.kill('SIGTERM')
  if (child && child.exitCode === null) await Promise.race([new Promise((done) => child.once('exit', done)), delay(5_000).then(() => child.kill('SIGKILL'))])
  stub.closeAllConnections()
  await new Promise((done) => stub.close(done))
  await rm(root, { recursive: true, force: true })
}

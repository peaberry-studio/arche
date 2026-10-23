import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { OpenCode } from '@opencode/client'

import zenCatalog from '@/lib/providers/zen-catalog'

const { rewriteZenCatalog } = zenCatalog

const root = await mkdtemp(join(process.cwd(), '.v2-zen-catalog-probe-'))
const ids = ['opencode', 'opencode-go']
const requests = []
let refreshes = 0
let child
const key = randomBytes(24).toString('hex')
const stub = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://probe').pathname
  if (path === '/catalog/api.json') {
    refreshes++
    assert.equal(request.headers.authorization, undefined)
    // Keep the initial network refresh unresolved through both first requests.
    return
  }
  if (path.startsWith('/console/')) return response.writeHead(404).end()
  let body = ''
  for await (const chunk of request) body += chunk
  const input = body ? JSON.parse(body) : {}
  requests.push(path)
  if (request.headers.authorization !== `Bearer ${key}` || !ids.some((id) => path === `/providers/${id}/inference/openai/v1/chat/completions`)) {
    response.writeHead(400).end()
    return
  }
  const result = { id: 'chatcmpl-probe', object: 'chat.completion', created: 1, model: input.model }
  response.setHeader('Content-Type', input.stream ? 'text/event-stream' : 'application/json')
  if (!input.stream) {
    response.end(JSON.stringify({ ...result, choices: [{ index: 0, message: { role: 'assistant', content: 'seeded' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
    return
  }
  for (const delta of [{ role: 'assistant', content: 'seeded' }, {}]) {
    response.write(`data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
  }
  response.end(`data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`)
})

try {
  await Promise.all(['workspace', 'home', 'config/opencode', 'data', 'state', 'cache', 'tmp'].map((name) => mkdir(join(root, name), { recursive: true })))
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${stub.address().port}`
  const model = {
    id: 'fixture', name: 'Fixture', release_date: '2026-01-01', attachment: false, reasoning: false, tool_call: false,
    cost: { input: 0, output: 0 }, limit: { context: 32000, output: 1000 }, modalities: { input: ['text'], output: ['text'] },
    provider: { api: 'https://opencode.ai/inference/openai/v1' },
  }
  const catalog = Object.fromEntries(ids.map((id) => [id, {
    id, name: id, env: ['OPENCODE_API_KEY'], npm: '@ai-sdk/openai-compatible',
    api: 'https://opencode.ai/inference/openai/v1', models: { fixture: model },
  }]))
  const catalogPath = join(root, 'models-catalog.json')
  await writeFile(catalogPath, JSON.stringify(rewriteZenCatalog(catalog, `${endpoint}/providers`)))
  await writeFile(join(root, 'config/opencode/opencode.json'), JSON.stringify({
    update: 'disable', snapshots: false,
    providers: Object.fromEntries(ids.map((id) => [id, { settings: { baseURL: `${endpoint}/providers/${id}` } }])),
  }))
  const password = randomBytes(24).toString('hex')
  child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: join(root, 'workspace'),
    env: {
      PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'),
      XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
      XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache'),
      OPENCODE_SERVER_PASSWORD: password, OPENCODE_LOG_LEVEL: 'error',
      OPENCODE_MODELS_PATH: catalogPath, OPENCODE_MODELS_URL: `${endpoint}/catalog`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (chunk) => { log += chunk })
  child.stderr.on('data', (chunk) => { log += chunk })
  const deadline = Date.now() + 15_000
  while (!/http:\/\/127\.0\.0\.1:\d+/.test(log)) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error('runtime_start_failed')
    await delay(100)
  }
  const client = OpenCode.make({ baseUrl: log.match(/http:\/\/127\.0\.0\.1:\d+/)[0], headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } })
  const options = () => ({ signal: AbortSignal.timeout(5000) })
  assert.equal((await client.server.info(options())).version, '2.0.32')
  const models = (await client.model.list(undefined, options())).data
  for (const id of ids) {
    const found = models.filter((item) => item.providerID === id)
    assert(found.length > 0, `seeded ${id} models visible without credentials`)
    assert(found.every((item) => item.settings.baseURL === `${endpoint}/providers/${id}/inference/openai/v1`))
  }
  assert.deepEqual(await client.credential.list(options()), [])
  for (const integrationID of ids) {
    await client.credential.create({ integrationID, label: `arche-managed:${integrationID}`, value: { type: 'key', key, ...(integrationID === 'opencode' && { metadata: { server: `${endpoint}/console` } }) }, activate: true }, options())
    const result = await client.generate.text({ model: { providerID: integrationID, id: 'fixture' }, prompt: 'Reply briefly.' }, options())
    assert.equal(result.text, 'seeded')
  }
  assert.equal(requests.length, 2)
  assert(refreshes > 0, 'catalog refresh was held unresolved during first inference')
  console.log('PASS: fresh 2.0.32 storage; seeded Zen/Go endpoints precede activation; both first requests use gateway while refresh is unresolved')
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    await exited
    clearTimeout(timer)
  }
  stub.closeAllConnections()
  if (stub.listening) await new Promise((resolve) => stub.close(resolve))
  await rm(root, { recursive: true, force: true })
}

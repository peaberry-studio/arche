import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { OpenCode } from '@opencode/client'

const root = await mkdtemp(join(process.cwd(), '.v2-provider-probe-'))
const workspace = join(root, 'workspace')
const requests = []
const keys = new Map()
const observations = {}
let child
const stub = createServer(async (request, response) => {
  let text = ''
  for await (const chunk of request) text += chunk
  const input = text ? JSON.parse(text) : {}
  const pathname = new URL(request.url, 'http://probe').pathname
  const key = String(request.headers.authorization ?? request.headers['x-api-key'] ?? '').replace(/^Bearer /, '')
  const label = keys.get(key) ?? 'none-or-unknown'
  requests.push({ path: request.url, credential: label, model: input.model })
  if (!keys.has(key)) {
    response.writeHead(401, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'Synthetic gateway credential required', type: 'authentication_error' } }))
    return
  }
  if (pathname.endsWith('/models')) {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture', object: 'model', owned_by: 'probe' }] }))
    return
  }
  if (pathname.endsWith('/chat/completions')) {
    response.setHeader('Content-Type', input.stream ? 'text/event-stream' : 'application/json')
    const base = { id: 'chatcmpl-probe', object: 'chat.completion', created: 1, model: input.model }
    if (!input.stream) {
      response.end(JSON.stringify({ ...base, choices: [{ index: 0, message: { role: 'assistant', content: 'gateway-fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
      return
    }
    for (const delta of [{ role: 'assistant', content: 'gateway-fixture' }, {}]) {
      response.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    }
    response.end(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`)
    return
  }
  if (pathname.endsWith('/responses')) {
    const item = { id: 'msg_probe', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'gateway-fixture', annotations: [] }] }
    const result = { id: 'resp_probe', object: 'response', created_at: 1, status: 'completed', model: input.model, output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }
    response.setHeader('Content-Type', input.stream ? 'text/event-stream' : 'application/json')
    if (!input.stream) { response.end(JSON.stringify(result)); return }
    for (const event of [
      { type: 'response.created', response: { ...result, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
      { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'gateway-fixture' },
      { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text: 'gateway-fixture' },
      { type: 'response.content_part.done', item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: result },
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    response.end()
    return
  }
  if (pathname.endsWith('/messages')) {
    response.setHeader('Content-Type', input.stream ? 'text/event-stream' : 'application/json')
    const message = { id: 'msg_probe', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'gateway-fixture' }], model: input.model, stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    if (!input.stream) { response.end(JSON.stringify(message)); return }
    for (const event of [
      { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'gateway-fixture' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    response.end()
    return
  }
  response.writeHead(404).end()
})

const freshKey = (label) => {
  const key = randomBytes(24).toString('hex')
  keys.set(key, label)
  return key
}

try {
  await Promise.all(['workspace', 'home', 'config/opencode', 'data', 'cache', 'state', 'tmp'].map((directory) => mkdir(join(root, directory), { recursive: true })))
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${stub.address().port}`
  const model = { capabilities: { tools: false, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 1000 } }
  const configPath = join(root, 'config/opencode/opencode.json')
  const config = {
    update: 'disable', snapshots: false,
    model: 'openai/fixture',
    providers: {
      openai: { settings: { baseURL: `${endpoint}/gateway/openai`, transport: 'http', encoding: 'none' }, models: { fixture: model } },
      fixture: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `${endpoint}/gateway/fixture` }, models: { fixture: model } },
    },
    policies: [{ action: 'provider.use', resource: '*', effect: 'deny' }, ...['openai', 'fixture'].map((resource) => ({ action: 'provider.use', resource, effect: 'allow' }))],
  }
  const runtimeProviderIds = ['openai', 'anthropic', 'fireworks', 'fireworks-ai', 'huggingface', 'openrouter', 'zai', 'opencode', 'opencode-go', 'ollama']
  for (const id of runtimeProviderIds) {
    if (id === 'openai') continue
    config.providers[id] = { settings: { baseURL: `${endpoint}/gateway/${id === 'fireworks-ai' ? 'fireworks' : id}` }, models: { fixture: model }, ...(id === 'ollama' ? { package: 'aisdk:@ai-sdk/openai-compatible' } : {}) }
    config.policies.push({ action: 'provider.use', resource: id, effect: 'allow' })
  }
  await writeFile(configPath, JSON.stringify(config))
  const password = randomBytes(24).toString('hex')
  child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: workspace,
    env: { PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache'), OPENCODE_SERVER_PASSWORD: password, OPENCODE_LOG_LEVEL: 'error' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (chunk) => { log += chunk })
  child.stderr.on('data', (chunk) => { log += chunk })
  const waitFor = async (predicate, label, budget = 15_000) => {
    const deadline = Date.now() + budget
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error(`Timeout: ${label}`)
      await delay(100)
    }
  }
  await waitFor(() => /http:\/\/127\.0\.0\.1:\d+/.test(log), 'server URL')
  const client = OpenCode.make({ baseUrl: log.match(/http:\/\/127\.0\.0\.1:\d+/)[0], headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } })
  await waitFor(async () => { try { return (await client.server.info({ signal: AbortSignal.timeout(1000) })).version === '2.0.32' } catch { return false } }, 'readiness')
  const openapi = await (await fetch(`${log.match(/http:\/\/127\.0\.0\.1:\d+/)[0]}/openapi.json`, { headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } })).json()
  observations.configApis = Object.fromEntries(Object.entries(openapi.paths).filter(([path]) => path.includes('/config')).map(([path, methods]) => [path, Object.keys(methods)]))
  observations.configPatchSchema = openapi.components.schemas['Config.Patch']
  const generate = async (providerID, stage) => {
    const before = requests.length
    try {
      const result = await client.generate.text({ model: { providerID, id: 'fixture' }, prompt: 'Reply with gateway-fixture.' }, { signal: AbortSignal.timeout(5000) })
      observations[stage] = { ok: true, result, requests: requests.slice(before) }
    } catch (error) {
      observations[stage] = { ok: false, tag: error?._tag ?? error?.reason ?? error?.name, message: error?.message, requests: requests.slice(before) }
    }
  }
  const state = async (label) => {
    const providers = (await client.provider.list({ location: { directory: workspace } })).data
    const models = (await client.model.list({ location: { directory: workspace } })).data
    observations[label] = {
      providers: providers.filter((provider) => ['openai', 'fixture'].includes(provider.id)).map(({ id, integrationID, activation, package: runtime }) => ({ id, integrationID, activation, runtime })),
      models: models.filter((model) => ['openai', 'fixture'].includes(model.providerID) && model.id === 'fixture').map(({ providerID, id, enabled }) => ({ providerID, id, enabled })),
      credentials: (await client.credential.list()).map(({ id, integrationID, active, label }) => ({ id, integrationID, active, label })),
    }
  }
  const generateSession = async (stage) => {
    const before = requests.length
    const session = await client.session.create({ title: 'Probe', model: { providerID: 'fixture', id: 'fixture' }, location: { directory: workspace } })
    await client.session.prompt({ sessionID: session.id, text: 'Reply briefly.' })
    let assistant
    await waitFor(async () => {
      assistant = (await client.message.list({ sessionID: session.id, order: 'asc' })).data.find((message) => message.type === 'assistant' && (message.time.completed || message.error))
      return assistant
    }, 'location-scoped session generation')
    observations[stage] = { text: assistant.content.filter((part) => part.type === 'text').map((part) => part.text).join(''), error: assistant.error, requests: requests.slice(before) }
  }
  await state('initial')
  for (const [integrationID, label] of [['openai', 'old-inactive'], ['openai', 'old-active'], ['anthropic', 'unrelated-owned']]) {
    await client.credential.create({ integrationID, label, value: { type: 'key', key: freshKey(label) }, activate: true })
  }
  const old = await client.credential.list()
  const removalOrder = [...old].sort((left, right) => Number(left.active) - Number(right.active))
  for (const credential of removalOrder) await client.credential.remove({ credentialID: credential.id })
  assert.deepEqual(await client.credential.list(), [], 'owned credential store purged before replacement')
  observations.purge = { removed: removalOrder.map(({ integrationID, active, label }) => ({ integrationID, active, label })), empty: true }
  await client.credential.create({ integrationID: 'openai', label: 'gateway-1', value: { type: 'key', key: freshKey('gateway-1') }, activate: true })
  await client.location.reload({ signal: AbortSignal.timeout(10_000) })
  await delay(2000)
  await state('afterCredentialReload')
  await generate('openai', 'credentialGeneration')
  await client.credential.create({ integrationID: 'fixture', label: 'custom-gateway-credential', value: { type: 'key', key: freshKey('custom-gateway-credential') }, activate: true })
  await client.location.reload({ signal: AbortSignal.timeout(10_000) })
  await delay(1000)
  await state('customCredentialReload')
  await generate('fixture', 'customCredentialGeneration')
  for (const id of runtimeProviderIds.filter((id) => id !== 'openai')) {
    await client.credential.create({ integrationID: id, label: `gateway-${id}`, value: { type: 'key', key: freshKey(`gateway-${id}`) }, activate: true })
  }
  await client.location.reload({ signal: AbortSignal.timeout(10_000) })
  await delay(1000)
  observations.productionProviderMappings = (await client.provider.list({ location: { directory: workspace } })).data.filter((provider) => runtimeProviderIds.includes(provider.id)).map(({ id, integrationID, activation, package: runtime }) => ({ id, integrationID, activation, runtime }))
  for (const id of runtimeProviderIds) await generate(id, `productionCredential:${id}`)
  for (const credential of await client.credential.list()) await client.credential.remove({ credentialID: credential.id })
  await client.location.reload({ signal: AbortSignal.timeout(10_000) })
  await delay(1000)
  await state('afterRevocation')
  await generate('openai', 'revokedGeneration')
  for (const id of runtimeProviderIds.filter((id) => id !== 'fireworks')) await generate(id, `revokedCredential:${id}`)
  config.providers.openai.settings.apiKey = freshKey('config-gateway')
  config.providers.fixture.settings.apiKey = freshKey('custom-config-gateway')
  await writeFile(configPath, JSON.stringify(config))
  await client.location.reload({ signal: AbortSignal.timeout(10_000) })
  await delay(1000)
  await state('configAlternative')
  await generate('openai', 'configGeneration')
  await generate('fixture', 'customConfigGeneration')
  await mkdir(join(workspace, '.opencode'))
  await writeFile(join(workspace, '.opencode/opencode.json'), JSON.stringify({ providers: { fixture: { settings: { baseURL: `${endpoint}/bypass/fixture`, apiKey: freshKey('project-supplied') } } } }))
  await client.location.reload({ signal: AbortSignal.timeout(10_000) })
  await delay(1000)
  await generateSession('allowedProviderEndpointOverride')
  await rm(join(workspace, '.opencode/opencode.json'))
  config.policies = [{ action: 'provider.use', resource: '*', effect: 'deny' }]
  await writeFile(configPath, JSON.stringify(config))
  await client.location.reload({ signal: AbortSignal.timeout(10_000) })
  await delay(1000)
  await generate('openai', 'policyDeniedGeneration')
  assert.equal(observations.credentialGeneration.result?.text, 'gateway-fixture')
  assert.equal(observations.credentialGeneration.requests[0]?.credential, 'gateway-1')
  assert.equal(observations.customCredentialGeneration.result?.text, 'gateway-fixture')
  assert.equal(observations.customCredentialGeneration.requests[0]?.credential, 'custom-gateway-credential')
  for (const id of runtimeProviderIds.filter((id) => id !== 'fireworks')) {
    const result = observations[`productionCredential:${id}`]
    assert.equal(result.result?.text, 'gateway-fixture', `generation for ${id}`)
    assert(result.requests.length > 0)
    assert(result.requests.every((request) => request.credential === (id === 'openai' ? 'gateway-1' : `gateway-${id}`)), `gateway credential for ${id}`)
  }
  assert.equal(observations.revokedGeneration.ok, false)
  assert(observations.revokedGeneration.requests.every((request) => request.credential === 'none-or-unknown'))
  for (const id of runtimeProviderIds.filter((id) => id !== 'fireworks')) {
    const result = observations[`revokedCredential:${id}`]
    assert.equal(result.ok, false, `revoked generation for ${id}`)
    assert(result.requests.every((request) => request.credential === 'none-or-unknown'), `no old credential for ${id}`)
  }
  assert.equal(observations.policyDeniedGeneration.ok, false)
  assert.deepEqual(observations.policyDeniedGeneration.requests, [])
  assert.equal(observations.allowedProviderEndpointOverride.text, 'gateway-fixture')
  assert(observations.allowedProviderEndpointOverride.requests.some((request) => request.path.startsWith('/bypass/fixture/') && request.credential === 'project-supplied'))
  console.log(JSON.stringify(observations, null, 2).replaceAll(root, '/isolated'))
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    await Promise.race([exited, delay(5000).then(() => child.kill('SIGKILL'))])
    if (child.exitCode === null && child.signalCode === null) await exited
  }
  stub.closeAllConnections()
  if (stub.listening) await new Promise((resolve) => stub.close(resolve))
  await rm(root, { recursive: true, force: true })
}

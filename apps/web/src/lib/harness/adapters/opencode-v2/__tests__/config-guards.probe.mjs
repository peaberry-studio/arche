// Run from apps/web with: ./node_modules/.bin/tsx src/lib/harness/adapters/opencode-v2/__tests__/config-guards.probe.mjs
// tsx resolves the `@/` alias so the probe exercises the real production renderer output.
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
const transformsModule = await import('@/lib/spawner/agent-config-transforms')
const renderRuntimeConfig = rendererModule.renderRuntimeConfig ?? rendererModule.default.renderRuntimeConfig
const createRuntimeConfigModel = modelModule.createRuntimeConfigModel ?? modelModule.default.createRuntimeConfigModel
const transforms = transformsModule.default ?? transformsModule

const SOURCE = {
  default_agent: 'assistant',
  agent: {
    assistant: { prompt: 'Follow CALL instructions.', tools: { task: true, read: true, write: true, edit: true, bash: true } },
    worker: { mode: 'subagent', description: 'Probe worker', prompt: 'Answer briefly.', tools: { read: true } },
    delegator: { mode: 'all', description: 'Probe delegator', prompt: 'Follow CALL instructions.', tools: { task: true, read: true } },
  },
}
const PERMISSIVE_OVERRIDE = {
  permissions: [{ action: '*', resource: '*', effect: 'allow' }],
  agents: { assistant: { permissions: [{ action: '*', resource: '*', effect: 'allow' }] } },
  policies: [{ action: 'tool.use', resource: '*', effect: 'allow' }],
}
const ORIGINAL = 'original\n'
const root = await mkdtemp(join(process.cwd(), '.v2-config-guards-probe-'))
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
    : { role: 'assistant', content: last?.role === 'tool' ? 'done' : 'child ok' }
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

function render(guards = {}) {
  const model = createRuntimeConfigModel(SOURCE)
  const rendered = renderRuntimeConfig({ ...model, guards: { ...model.guards, ...guards } })
  assert.equal(rendered.ok, true, JSON.stringify(rendered.error))
  return rendered.data.config
}

// Mirrors buildBaseWorkspaceConfig without DB-backed connectors: tool-map materialization,
// skill access, the injected knowledge curator and built-in tool remapping.
function renderPipeline() {
  let config = transforms.materializeAgentToolMaps(structuredClone(SOURCE))
  config = transforms.remapAgentConnectorTools(config, new Set())
  config = { ...config, mcp: { arche_tools: { type: 'local', command: ['node', '/nonexistent/arche-tools/server.js'], enabled: false } } }
  config = transforms.injectSystemSkillAccess(config, ['arche-flow-authoring'])
  config = transforms.injectSystemKnowledgeCuratorAgent(config)
  delete config.agent['knowledge-curator'].permission.doom_loop
  config = transforms.remapAgentBuiltInTools(config)
  const rendered = renderRuntimeConfig(createRuntimeConfigModel(config))
  assert.equal(rendered.ok, true, JSON.stringify(rendered.error))
  return rendered.data.config
}

async function withServe(name, { config, override }, run) {
  const directory = join(root, name)
  const workspace = join(directory, 'workspace')
  await Promise.all(['workspace', 'home', 'config', 'data', 'cache', 'state', 'tmp'].map((entry) => mkdir(join(directory, entry), { recursive: true })))
  await mkdir(join(workspace, '.opencode'))
  await mkdir(join(workspace, 'nested'))
  await writeFile(join(workspace, 'notes.txt'), ORIGINAL)
  const model = { capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 1000 }, cost: { input: 1, output: 2 } }
  // Only the provider target is replaced with the loopback fixture; agents, permissions and policies are the renderer's.
  await writeFile(join(workspace, 'opencode.json'), JSON.stringify({
    ...config,
    update: 'disable',
    model: 'fixture/fixture',
    snapshots: false,
    providers: { fixture: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${stub.address().port}/v1`, apiKey: randomBytes(16).toString('hex') }, models: { fixture: model } } },
  }))
  if (override) await writeFile(join(workspace, '.opencode', 'opencode.json'), JSON.stringify(override))
  const password = randomBytes(24).toString('hex')
  const child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: workspace,
    env: { PATH: process.env.PATH, HOME: join(directory, 'home'), TMPDIR: join(directory, 'tmp'), XDG_CONFIG_HOME: join(directory, 'config'), XDG_DATA_HOME: join(directory, 'data'), XDG_STATE_HOME: join(directory, 'state'), XDG_CACHE_HOME: join(directory, 'cache'), OPENCODE_SERVER_PASSWORD: password, OPENCODE_LOG_LEVEL: 'error' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (chunk) => { log += chunk })
  child.stderr.on('data', (chunk) => { log += chunk })
  try {
    await waitFor(() => /http:\/\/127\.0\.0\.1:\d+/.test(log), `${name} server URL`)
    const client = OpenCode.make({ baseUrl: log.match(/http:\/\/127\.0\.0\.1:\d+/)[0], headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } })
    await waitFor(async () => { try { return (await client.server.info()).version === '2.0.32' } catch { return false } }, `${name} 2.0.32 readiness`)
    const callTool = async (tool, args, agent = 'assistant') => {
      const session = await client.session.create({ title: tool, agent, model: { providerID: 'fixture', id: 'fixture' }, location: { directory: workspace } })
      const start = requests.length
      await client.session.prompt({ sessionID: session.id, text: `CALL:${Buffer.from(JSON.stringify({ name: tool, args })).toString('base64')}` })
      await waitFor(() => requests.slice(start).some((input) => input.messages.at(-1)?.role === 'tool'), `${name} ${tool} result`)
      await waitFor(async () => Object.keys(await client.session.active()).length === 0, `${name} ${tool} idle`)
      const output = requests.slice(start).find((input) => input.messages.at(-1)?.role === 'tool').messages.at(-1).content
      const children = (await client.session.list({ directory: workspace, parentID: session.id })).data
      return { output: typeof output === 'string' ? output : JSON.stringify(output), children: children.length }
    }
    const content = async (path) => readFile(join(workspace, path), 'utf8').catch(() => null)
    return await run({ client, workspace, callTool, content })
  } finally {
    child.kill('SIGTERM')
    if (child.exitCode === null) await Promise.race([new Promise((done) => child.once('exit', done)), delay(5_000).then(() => child.kill('SIGKILL'))])
  }
}

try {
  await new Promise((done) => stub.listen(0, '127.0.0.1', done))
  const production = render()

  await withServe('production', { config: production }, async ({ client, workspace, callTool, content }) => {
    const document = (await client.config.get({ location: { directory: workspace } })).find((entry) => entry.type === 'document' && entry.info.agents?.assistant)
    assert(document, 'rendered production config loaded')
    assert.deepEqual(document.info.policies, production.policies, 'policies round-trip unchanged')
    for (const id of ['assistant', 'worker', 'delegator']) {
      assert.deepEqual(document.info.agents[id].permissions, production.agents[id].permissions, `${id} permissions round-trip unchanged`)
      assert.deepEqual(document.info.agents[id].permissions.at(-1), { action: 'subagent', resource: id, effect: 'deny' })
      assert.equal(document.info.agents[id].system, production.agents[id].system, `${id} system round-trips unchanged`)
    }
    results.productionWrite = await callTool('write', { path: 'notes.txt', content: 'PWNED\n' })
    assert.equal(await content('notes.txt'), ORIGINAL, 'production config blocks edits')
    results.productionSelf = await callTool('subagent', { agent: 'assistant', description: 'self', prompt: 'CHILD_HELLO' })
    assert.equal(results.productionSelf.children, 0, 'primary self-delegation creates no child session')
    results.productionOther = await callTool('subagent', { agent: 'worker', description: 'other', prompt: 'CHILD_HELLO' })
    assert.equal(results.productionOther.children, 1, 'primary delegation to another agent still works')
    results.productionNonPrimary = await callTool('subagent', { agent: 'worker', description: 'other', prompt: 'CHILD_HELLO' }, 'delegator')
    assert.equal(results.productionNonPrimary.children, 0, 'execution guard keeps non-primary agents from delegating (v1 parity)')
  })

  const pipeline = renderPipeline()
  await withServe('pipeline', { config: pipeline }, async ({ client, workspace }) => {
    const document = (await client.config.get({ location: { directory: workspace } })).find((entry) => entry.type === 'document' && entry.info.agents?.['knowledge-curator'])
    assert(document, 'pipeline-shaped production config loaded')
    assert.deepEqual(document.info.policies, pipeline.policies, 'pipeline policies round-trip unchanged')
    assert.deepEqual(document.info.agents, pipeline.agents, 'pipeline agents round-trip unchanged')
    assert.deepEqual(document.info.mcp, pipeline.mcp, 'pipeline MCP round-trips unchanged')
    let listed = []
    await waitFor(async () => {
      listed = (await client.agent.list({ location: { directory: workspace } })).data
      return Object.keys(pipeline.agents).every((id) => listed.some((entry) => entry.id === id))
    }, 'pipeline agents listed')
    results.pipelineEffectivePermissions = listed.filter((entry) => entry.id in pipeline.agents).map((entry) => ({ id: entry.id, mode: entry.mode, tail: entry.permissions?.slice(entry.permissions.findLastIndex((rule) => rule.action === 'subagent')) }))
    for (const { id, tail } of results.pipelineEffectivePermissions) {
      assert.deepEqual(tail[0], { action: 'subagent', resource: id, effect: 'deny' }, `${id} effective permissions end their subagent rules with the self-deny`)
    }
  })

  await withServe('override', { config: production, override: PERMISSIVE_OVERRIDE }, async ({ workspace, callTool, content }) => {
    results.overrideWrite = await callTool('write', { path: 'notes.txt', content: 'PWNED\n' })
    assert.equal(await content('notes.txt'), ORIGINAL, 'project .opencode override cannot lift the edit policy')
    assert.match(results.overrideWrite.output, /Blocked by configuration policy/)
    results.overrideConfigWrite = await callTool('write', { path: join(workspace, '.opencode', 'opencode.json'), content: '{}' })
    assert.equal(JSON.parse(await content('.opencode/opencode.json')).policies.length, 1, 'policy blocks rewriting project config')
    assert.match(results.overrideConfigWrite.output, /Blocked by configuration policy/)
  })

  await withServe('control-no-policies', { config: { ...production, policies: [] }, override: PERMISSIVE_OVERRIDE }, async ({ callTool, content }) => {
    results.controlWrite = await callTool('write', { path: 'notes.txt', content: 'PWNED\n' })
    assert.equal(await content('notes.txt'), 'PWNED\n', 'negative control: without policies the override re-allows edits')
  })

  await withServe('control-primary-no-self-deny', { config: render({ selfDelegation: false }) }, async ({ callTool }) => {
    results.controlPrimarySelf = await callTool('subagent', { agent: 'assistant', description: 'self', prompt: 'CHILD_HELLO' })
    assert.equal(results.controlPrimarySelf.children, 0, 'primary agents cannot run as subagents even without the self-deny')
  })

  const delegating = render({ execution: false })
  await withServe('self-deny', { config: delegating }, async ({ client, workspace, callTool }) => {
    const document = (await client.config.get({ location: { directory: workspace } })).find((entry) => entry.type === 'document' && entry.info.agents?.delegator)
    assert.match(document.info.agents.delegator.system, /## Delegation constraint/)
    results.nonPrimarySelf = await callTool('subagent', { agent: 'delegator', description: 'self', prompt: 'CHILD_HELLO' }, 'delegator')
    assert.equal(results.nonPrimarySelf.children, 0, 'self-deny permission blocks non-primary self-delegation')
    results.nonPrimaryOther = await callTool('subagent', { agent: 'worker', description: 'other', prompt: 'CHILD_HELLO' }, 'delegator')
    assert.equal(results.nonPrimaryOther.children, 1, 'self-deny does not ban delegation to other agents')
  })

  await withServe('control-no-self-deny', { config: render({ execution: false, selfDelegation: false }) }, async ({ callTool }) => {
    results.controlNonPrimarySelf = await callTool('subagent', { agent: 'delegator', description: 'self', prompt: 'CHILD_HELLO' }, 'delegator')
    assert.equal(results.controlNonPrimarySelf.children, 1, 'negative control: without the self-deny a non-primary agent can delegate to itself')
  })

  await withServe('self-deny-override', { config: delegating, override: { agents: { delegator: { permissions: [{ action: '*', resource: '*', effect: 'allow' }] } } } }, async ({ callTool }) => {
    results.overrideNonPrimarySelf = await callTool('subagent', { agent: 'delegator', description: 'self', prompt: 'CHILD_HELLO' }, 'delegator')
  })

  await withServe('workspace-guards', { config: render({ knowledgeWrites: false }), override: PERMISSIVE_OVERRIDE }, async ({ workspace, callTool, content }) => {
    results.workspaceNotes = await callTool('write', { path: 'notes.txt', content: 'EDITED\n' })
    assert.equal(await content('notes.txt'), 'EDITED\n', 'workspace guards keep ordinary edits')
    for (const [label, path, check] of [
      ['root json', 'opencode.json', 'opencode.json'],
      ['root jsonc', 'opencode.jsonc', 'opencode.jsonc'],
      ['nested json', 'nested/opencode.json', 'nested/opencode.json'],
      ['nested jsonc', 'nested/opencode.jsonc', 'nested/opencode.jsonc'],
      ['absolute root json', join(workspace, 'opencode.json'), 'opencode.json'],
      ['absolute dot-opencode', join(workspace, '.opencode', 'agents', 'x.md'), '.opencode/agents/x.md'],
      ['AGENTS.md', 'AGENTS.md', 'AGENTS.md'],
    ]) {
      const before = await content(check)
      const result = await callTool('write', { path, content: '{"policies":[]}' })
      assert.equal(await content(check), before, `${label} edit is blocked`)
      assert.match(result.output, /Blocked by configuration policy/, `${label} is blocked by policy`)
    }
  })

  console.log(JSON.stringify(results, null, 2).replaceAll(root, '<root>'))
  console.log('PASS: rendered production V2 config (and a pipeline-shaped config with curator, skills and built-in remaps) round-trips; policies block edits and runtime-config paths even with a permissive project .opencode override (negative control: override re-allows edits without policies); primary agents cannot run as subagents; the per-agent self-deny blocks non-primary self-delegation while other delegation works (negative control: self-delegation succeeds without it)')
} finally {
  stub.closeAllConnections()
  await new Promise((done) => stub.close(done))
  await rm(root, { recursive: true, force: true })
}

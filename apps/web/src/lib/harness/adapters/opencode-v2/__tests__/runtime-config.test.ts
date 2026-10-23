import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { renderRuntimeConfig } from '@/lib/harness/adapters/opencode-v2/runtime-config'
import { createRuntimeConfigModel, type RuntimeConfigModel } from '@/lib/harness/runtime-config'
import { isRecord } from '@/lib/records'
import { AGENT_KB_POLICY_PROMPT_BLOCK } from '@/lib/spawner/runtime-config-utils'

type Rule = { action: string; resource: string; effect: string }

function unprotectedModel(source: Record<string, unknown>): RuntimeConfigModel {
  const model = createRuntimeConfigModel(source)
  return { ...model, guards: { ...model.guards, selfDelegation: false } }
}

function config(model: RuntimeConfigModel): Record<string, unknown> {
  const result = renderRuntimeConfig(model)
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  expect(result.data.skillDirectory).toBe('.opencode/skills')
  expect(JSON.parse(result.data.opencodeConfigContent)).toEqual(result.data.config)
  return result.data.config
}

function agentConfig(rendered: Record<string, unknown>, id: string): Record<string, unknown> {
  if (!isRecord(rendered.agents) || !isRecord(rendered.agents[id])) throw new Error('missing agent')
  return rendered.agents[id]
}

function rules(value: unknown): Rule[] {
  if (!Array.isArray(value)) throw new Error('missing rules')
  return value.map((rule: unknown) => {
    if (!isRecord(rule) || typeof rule.action !== 'string' || typeof rule.resource !== 'string' || typeof rule.effect !== 'string') throw new Error('invalid rule')
    return { action: rule.action, resource: rule.resource, effect: rule.effect }
  })
}

function decision(value: unknown, action: string, resource: string): string | undefined {
  const matches = (pattern: string, input: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(input)
  return rules(value).filter((rule) => matches(rule.action, action) && matches(rule.resource, resource)).at(-1)?.effect
}

const PRODUCTION_SOURCE = {
  default_agent: 'orchestrator',
  agent: {
    orchestrator: { tools: { task: true, read: true } },
    reviewer: { mode: 'subagent', tools: { read: true } },
    delegator: { mode: 'all', tools: { task: true, read: true } },
  },
}

function protectedGuardViolations(rendered: Record<string, unknown>): string[] {
  const violations: string[] = []
  if (!isRecord(rendered.agents)) return ['agents']
  for (const id of Object.keys(rendered.agents)) {
    const delegation = rules(agentConfig(rendered, id).permissions).filter((rule) => rule.action === 'subagent' || rule.action === '*')
    const last = delegation.at(-1)
    if (last?.action !== 'subagent' || last.resource !== id || last.effect !== 'deny') violations.push(`agents.${id}.selfDelegation`)
  }
  if (decision(rendered.policies, 'tool.use', 'edit:notes.md') !== 'deny') violations.push('policies.knowledgeWrites')
  const workspacePolicies = rules(rendered.policies).filter((rule) => rule.resource !== 'edit:*')
  const workspaceResources = ['edit:opencode.json', 'edit:nested/opencode.jsonc', 'edit:.opencode/opencode.json', 'edit:AGENTS.md', 'shell:pnpm add left-pad']
  if (workspaceResources.some((resource) => decision(workspacePolicies, 'tool.use', resource) !== 'deny')) violations.push('policies.workspace')
  return violations
}

describe('V2 runtime config renderer', () => {
  it('renders the production model with the shared agent prompts, a last-wins self-deny per agent, and guard policies', () => {
    const model = createRuntimeConfigModel(PRODUCTION_SOURCE)
    expect(model.guards).toEqual({ knowledgeWrites: true, execution: true, workspace: true, selfDelegation: true })
    const rendered = config(model)

    expect(protectedGuardViolations(rendered)).toEqual([])
    for (const id of ['orchestrator', 'reviewer', 'delegator']) {
      expect(agentConfig(rendered, id).system).toEqual(expect.stringContaining(`Your current agent id is "${id}".`))
      expect(String(agentConfig(rendered, id).system).endsWith(AGENT_KB_POLICY_PROMPT_BLOCK)).toBe(true)
    }
    expect(decision(agentConfig(rendered, 'orchestrator').permissions, 'subagent', 'reviewer')).toBe('allow')
    expect(decision(agentConfig(rendered, 'delegator').permissions, 'subagent', 'reviewer')).toBe('deny')
    expect(rules(rendered.policies).some((rule) => rule.resource.startsWith('subagent:'))).toBe(false)
    for (const resource of ['edit:opencode.json', 'edit:opencode.jsonc', 'edit:nested/opencode.json', 'edit:nested/opencode.jsonc', 'edit:.opencode/opencode.json', 'edit:/workspace/.opencode/agents/x.md', 'shell:cat opencode.jsonc', 'shell:npm install left-pad']) {
      expect(decision(rendered.policies, 'tool.use', resource)).toBe('deny')
    }
  })

  it('adds the delegation constraint text to self-delegating agents and keeps the self-deny after authored allows', () => {
    const source = { agent: {
      orchestrator: { mode: 'primary', tools: { task: true } },
      delegator: { mode: 'all', tools: { task: true }, permission: { task: { '*': 'allow', delegator: 'allow' } } },
    } }
    const model = { ...createRuntimeConfigModel(source), guards: { knowledgeWrites: true, execution: false, workspace: true, selfDelegation: true } }
    const rendered = config(model)
    const delegator = agentConfig(rendered, 'delegator')

    expect(delegator.system).toEqual(expect.stringContaining('## Delegation constraint\nCRITICAL: You MUST NEVER use the task tool to invoke yourself ("delegator"). Self-delegation creates an infinite loop. You may delegate to: orchestrator.'))
    expect(agentConfig(rendered, 'orchestrator').system).not.toContain('## Delegation constraint')
    expect(decision(delegator.permissions, 'subagent', 'delegator')).toBe('deny')
    expect(decision(delegator.permissions, 'subagent', 'orchestrator')).toBe('allow')
    expect(protectedGuardViolations(rendered)).toEqual([])
  })

  it.each([
    { name: 'the self-deny is removed', mutate: (rendered: Record<string, unknown>) => { agentConfig(rendered, 'delegator').permissions = rules(agentConfig(rendered, 'delegator').permissions).slice(0, -1) }, violation: 'agents.delegator.selfDelegation' },
    { name: 'an allow follows the self-deny', mutate: (rendered: Record<string, unknown>) => { agentConfig(rendered, 'orchestrator').permissions = [...rules(agentConfig(rendered, 'orchestrator').permissions), { action: 'subagent', resource: '*', effect: 'allow' }] }, violation: 'agents.orchestrator.selfDelegation' },
    { name: 'the edit policy is removed', mutate: (rendered: Record<string, unknown>) => { rendered.policies = rules(rendered.policies).filter((rule) => rule.resource !== 'edit:*') }, violation: 'policies.knowledgeWrites' },
    { name: 'the workspace policies are removed', mutate: (rendered: Record<string, unknown>) => { rendered.policies = rules(rendered.policies).filter((rule) => rule.resource === 'edit:*') }, violation: 'policies.workspace' },
  ])('negative control: the protected-guard check fails when $name', ({ mutate, violation }) => {
    const rendered = config(createRuntimeConfigModel(PRODUCTION_SOURCE))
    mutate(rendered)
    expect(protectedGuardViolations(rendered)).toContain(violation)
  })

  it('does not accept caller predicates or agent policies absent from the 2.0.32 schema', () => {
    expect(renderRuntimeConfig(unprotectedModel({
      policies: [{ action: 'tool.use', resource: 'subagent:worker', effect: 'deny', agent: 'worker' }],
    }))).toMatchObject({ ok: false, error: { code: 'runtime_config_unsupported', path: 'policies.0' } })
    expect(renderRuntimeConfig(unprotectedModel({ agent: { worker: {
      policies: [{ action: 'tool.use', resource: 'subagent:worker', effect: 'deny' }],
    } } }))).toMatchObject({ ok: false, error: { code: 'runtime_config_unsupported', path: 'agents.worker.policies' } })
  })

  it('snapshots delegation and execution rules for every agent kind', () => {
    const snapshots = Object.fromEntries(['primary', 'subagent', 'all'].map((mode) => {
      const rendered = config(unprotectedModel({ agent: { worker: { mode, tools: { task: true } } } }))
      const worker = agentConfig(rendered, 'worker')
      return [mode, { mode: worker.mode, steps: worker.steps, delegation: rules(worker.permissions).filter((rule) => rule.action === 'subagent') }]
    }))
    expect(snapshots).toMatchInlineSnapshot(`
      {
        "all": {
          "delegation": [
            {
              "action": "subagent",
              "effect": "allow",
              "resource": "*",
            },
            {
              "action": "subagent",
              "effect": "deny",
              "resource": "*",
            },
          ],
          "mode": "all",
          "steps": 40,
        },
        "primary": {
          "delegation": [
            {
              "action": "subagent",
              "effect": "allow",
              "resource": "*",
            },
          ],
          "mode": "primary",
          "steps": 120,
        },
        "subagent": {
          "delegation": [
            {
              "action": "subagent",
              "effect": "allow",
              "resource": "*",
            },
            {
              "action": "subagent",
              "effect": "deny",
              "resource": "*",
            },
          ],
          "mode": "subagent",
          "steps": 40,
        },
      }
    `)
  })

  it.each(['primary', 'subagent', 'all'])('renders native agent fields and guards for %s', (mode) => {
    const model = unprotectedModel({
      default_model: 'openai/default',
      agent: { worker: {
        mode,
        prompt: 'Do the work.',
        variant: 'high',
        disable: false,
        temperature: 0.2,
        top_p: 0.8,
        steps: 500,
        tools: { read: true, bash: true, task: true, write: false, edit: false },
        permission: { bash: { '*': 'ask', 'git status *': 'allow' } },
      } },
    })
    const rendered = config(model)
    const worker = agentConfig(rendered, 'worker')

    expect({
      mode: worker.mode,
      model: worker.model,
      disabled: worker.disabled,
      request: worker.request,
      steps: worker.steps,
      shellDefault: decision(worker.permissions, 'shell', 'ls'),
      shellException: decision(worker.permissions, 'shell', 'git status --short'),
      selfDelegation: decision(worker.permissions, 'subagent', 'worker'),
      otherDelegation: decision(worker.permissions, 'subagent', 'reviewer'),
      externalAccess: decision(worker.permissions, 'external_directory', '/external/*'),
      editing: decision(worker.permissions, 'edit', 'file.md'),
    }).toEqual({
      mode,
      model: 'openai/default#high',
      disabled: false,
      request: { body: { temperature: 0.2, top_p: 0.8 } },
      steps: mode === 'primary' ? 120 : 40,
      shellDefault: 'ask',
      shellException: 'allow',
      selfDelegation: mode === 'primary' ? 'allow' : 'deny',
      otherDelegation: mode === 'primary' ? 'allow' : 'deny',
      externalAccess: 'ask',
      editing: 'deny',
    })
    expect(worker.system).toEqual(expect.stringContaining('Your current agent id is "worker".'))
    expect(String(worker.system).endsWith(AGENT_KB_POLICY_PROMPT_BLOCK)).toBe(true)
    for (const legacy of ['agent', 'provider', 'permission', 'tools', 'default_model']) expect(rendered).not.toHaveProperty(legacy)
    for (const legacy of ['prompt', 'permission', 'tools', 'variant', 'disable', 'temperature', 'top_p']) expect(worker).not.toHaveProperty(legacy)
    expect(model.agents?.[0]?.settings.temperature).toBe(0.2)
  })

  it('renders local direct built-ins, remote connector auth, timeout purposes, and provider gateways', () => {
    const rendered = config(unprotectedModel({
      default_agent: 'assistant',
      snapshot: false,
      mcp: {
        arche_tools: { type: 'local', command: ['node', '/opt/arche/arche-tools/server.js'], enabled: true },
        arche_linear_1: { type: 'remote', url: 'https://gateway.example/mcp', headers: { Authorization: 'Bearer token' }, oauth: false, enabled: false, timeout: 1234 },
      },
      provider: {
        ollama: { npm: '@ai-sdk/openai-compatible', name: 'Ollama', options: { baseURL: 'https://gateway.example/ollama', apiKey: '{env:K}' }, models: { coding: { id: 'upstream-coding', name: 'Coding' } } },
        openai: { options: { baseURL: 'https://gateway.example/openai' } },
      },
      agent: { assistant: { mode: 'all', tools: { read: true } } },
    }))

    expect(rendered).toMatchObject({
      snapshots: false,
      mcp: { servers: {
        arche_tools: { type: 'local', command: ['node', '/opt/arche/arche-tools/server.js'], disabled: false, codemode: false },
        arche_linear_1: { type: 'remote', url: 'https://gateway.example/mcp', headers: { Authorization: 'Bearer token' }, oauth: false, disabled: true, timeout: { catalog: 1234, execution: 1234 }, codemode: false },
      } },
      providers: {
        ollama: { package: 'aisdk:@ai-sdk/openai-compatible', settings: { baseURL: 'https://gateway.example/ollama', apiKey: '{env:K}' }, models: { coding: { modelID: 'upstream-coding', name: 'Coding' } } },
        openai: { settings: { baseURL: 'https://gateway.example/openai' } },
      },
      agents: { assistant: { mode: 'primary', steps: 120 } },
    })
    expect(rendered).not.toHaveProperty('snapshot')
  })

  it('preserves confirmed 2.0.32 MCP fields and forces built-ins into direct mode', () => {
    const rendered = config(unprotectedModel({ mcp: {
      arche_tools: { type: 'local', command: ['node', '/opt/arche/arche-tools/server.js'], codemode: true, cwd: '/workspace', environment: { MODE: 'test' }, protocol: 'legacy' },
      arche_remote: { type: 'remote', url: 'https://gateway.example/mcp', codemode: true, protocol: '2026-07-28', oauth: false },
    } }))
    expect(rendered.mcp).toEqual({ servers: {
      arche_tools: { type: 'local', command: ['node', '/opt/arche/arche-tools/server.js'], codemode: false, cwd: '/workspace', environment: { MODE: 'test' }, protocol: 'legacy' },
      arche_remote: { type: 'remote', url: 'https://gateway.example/mcp', codemode: true, protocol: '2026-07-28', oauth: false },
    } })
  })

  it('preserves valid native model references, hex colors, timeout disabling, and matching permission aliases', () => {
    const rendered = config(unprotectedModel({
      model: 'openai/default',
      default_model: ' openai/fallback ',
      permission: { bash: { '*': 'ask' }, shell: { '*': 'ask' } },
      agent: { worker: { model: '  ', color: '#Ab12ef' } },
      provider: { openai: { options: { timeout: false, headerTimeout: 1234, chunkTimeout: false }, models: { coding: { limit: { context: 1000, input: 800, output: 200 } } } } },
    }))
    expect(rendered.model).toBe('openai/default')
    expect(agentConfig(rendered, 'worker')).toMatchObject({ model: 'openai/fallback', color: '#Ab12ef' })
    expect(rendered.providers).toEqual({ openai: { settings: { timeout: false, headerTimeout: 1234, chunkTimeout: false }, models: { coding: { limit: { context: 1000, input: 800, output: 200 } } } } })
    expect(decision(rendered.permissions, 'shell', 'git status')).toBe('ask')
  })

  it('keeps spreadsheet-only tools, inherited asks, and exact connector restrictions', () => {
    const rendered = config(unprotectedModel({
      permission: { '*': 'ask' },
      tools: { 'arche_tools_*': false },
      agent: { analyst: {
        tools: { 'arche_*': true, 'arche_tools_*': false, arche_tools_spreadsheet_query: true, arche_tools_spreadsheet_stats: true, arche_linear_1_delete: false },
        permission: { 'arche_tools_*': 'deny', arche_tools_spreadsheet_query: 'ask', arche_tools_spreadsheet_stats: 'allow' },
      } },
    }))
    const analyst = agentConfig(rendered, 'analyst')

    expect(decision(analyst.permissions, 'arche_tools_spreadsheet_query', '*')).toBe('ask')
    expect(decision(analyst.permissions, 'arche_tools_spreadsheet_stats', '*')).toBe('allow')
    expect(decision(analyst.permissions, 'arche_tools_learning_propose', '*')).toBe('deny')
    expect(decision(analyst.permissions, 'arche_tools_chart_create', '*')).toBe('deny')
    expect(decision(analyst.permissions, 'arche_linear_1_read', '*')).toBe('ask')
    expect(decision(analyst.permissions, 'arche_linear_1_delete', '*')).toBe('deny')
    expect(decision(analyst.permissions, 'shell', '*')).toBe('deny')
  })

  it('maps authored doom_loop permissions and denies doom loops for every agent like V1', () => {
    const rendered = config(createRuntimeConfigModel({
      default_agent: 'assistant',
      permission: { '*': 'allow' },
      agent: {
        assistant: { permission: { doom_loop: 'deny' } },
        worker: { mode: 'subagent', permission: { '*': 'allow', doom_loop: 'allow' } },
      },
    }))

    expect(decision(agentConfig(rendered, 'assistant').permissions, 'doom_loop', '*')).toBe('deny')
    expect(decision(agentConfig(rendered, 'worker').permissions, 'doom_loop', '*')).toBe('deny')
  })

  it('ignores V1 tools that 2.0.32 does not ship instead of refusing the config', () => {
    const rendered = config(unprotectedModel({
      permission: { lsp: 'allow', todowrite: 'deny' },
      agent: { worker: { tools: { read: true, codesearch: true, lsp: false, todoread: true, todowrite: true } } },
    }))
    const worker = rules(agentConfig(rendered, 'worker').permissions)

    expect(worker.some((rule) => ['codesearch', 'lsp', 'todoread', 'todowrite'].includes(rule.action))).toBe(false)
    expect(decision(worker, 'read', '*')).toBe('allow')
    expect(decision(worker, 'shell', '*')).toBe('deny')
  })

  it.each([
    { tools: { read: true, list: false }, action: 'read', expected: 'allow' },
    { tools: { read: false, list: true }, action: 'read', expected: 'deny' },
    { tools: { edit: false, write: true }, action: 'edit', expected: 'deny' },
    { tools: { patch: true, write: false }, action: 'edit', expected: 'deny' },
    { tools: { bash: true, shell: false }, action: 'shell', expected: 'deny' },
  ])('resolves conflicting V1 aliases of one V2 action without widening access: $tools', ({ tools, action, expected }) => {
    const worker = rules(agentConfig(config(unprotectedModel({ agent: { worker: { tools } } })), 'worker').permissions)
    expect(decision(worker, action, '*')).toBe(expected)
  })

  it('hardens workspace writes with policies without globally denying delegation targets', () => {
    const rendered = config(unprotectedModel({
      policies: [{ action: 'tool.use', resource: 'edit:*', effect: 'allow' }],
      agent: {
        orchestrator: { mode: 'primary', tools: { task: true } },
        reviewer: { mode: 'subagent', tools: { read: true } },
      },
    }))

    expect(decision(rendered.policies, 'tool.use', 'edit:document.md')).toBe('deny')
    expect(decision(rendered.policies, 'tool.use', 'shell:npm install package')).toBe('deny')
    expect(rules(rendered.policies).some((rule) => rule.resource.startsWith('subagent:'))).toBe(false)
    expect(decision(agentConfig(rendered, 'orchestrator').permissions, 'subagent', 'reviewer')).toBe('allow')
    expect(decision(agentConfig(rendered, 'orchestrator').permissions, 'subagent', 'orchestrator')).toBe('allow')
  })

  it.each([
    { source: { permission: { typo: 'deny' } }, path: 'access.typo' },
    { source: { permission: { read: { '*': 'invalid' } } }, path: 'access.read.*' },
    { source: { permission: { read: 'deny', list: 'allow' } }, path: 'access.list' },
    { source: { permission: { bash: { '*': 'deny' }, shell: { '*': 'allow' } } }, path: 'access.shell' },
    { source: { agent: { worker: { permission: { edit: 'ask', write: 'allow' } } } }, path: 'agents.worker.access.write' },
    { source: { policies: [{ action: 'edit', resource: '*', effect: 'deny' }] }, path: 'policies.0.action' },
    { source: { experimental: { policies: [] } }, path: 'experimental' },
    { source: { provider: { custom: { options: { unknown: true } } } }, path: 'providers.custom.options.unknown' },
    { source: { provider: { custom: { name: false } } }, path: 'providers.custom.name' },
    { source: { provider: { custom: { env: ['KEY', false] } } }, path: 'providers.custom.env' },
    { source: { provider: { custom: { options: { apiKey: true } } } }, path: 'providers.custom.options.apiKey' },
    { source: { provider: { custom: { options: { timeout: true } } } }, path: 'providers.custom.options.timeout' },
    { source: { provider: { custom: { models: { coding: { id: false } } } } }, path: 'providers.custom.models.coding.id' },
    { source: { provider: { custom: { models: { coding: { limit: { context: 0.5 } } } } } }, path: 'providers.custom.models.coding.limit.context' },
    { source: { provider: { custom: { models: { coding: { limit: { unknown: 100 } } } } } }, path: 'providers.custom.models.coding.limit.unknown' },
    { source: { mcp: { custom: { enabled: true } } }, path: 'mcp.custom.type' },
    { source: { mcp: { arche_tools: { type: 'remote', url: 'https://example.com/mcp' } } }, path: 'mcp.arche_tools.type' },
    { source: { mcp: { custom: { type: 'local', command: ['node'], headers: {} } } }, path: 'mcp.custom.headers' },
    { source: { mcp: { custom: { type: 'remote', url: 'https://example.com/mcp', command: ['node'] } } }, path: 'mcp.custom.command' },
    { source: { mcp: { custom: { type: 'local', command: ['node'], environment: { KEY: true } } } }, path: 'mcp.custom.environment.KEY' },
    { source: { mcp: { custom: { type: 'remote', url: 'https://example.com/mcp', headers: { Authorization: true } } } }, path: 'mcp.custom.headers.Authorization' },
    { source: { mcp: { custom: { type: 'local', command: ['node'], codemode: 'false' } } }, path: 'mcp.custom.codemode' },
    { source: { mcp: { custom: { type: 'local', command: ['node'], cwd: false } } }, path: 'mcp.custom.cwd' },
    { source: { mcp: { custom: { type: 'local', command: ['node'], protocol: 'unsupported' } } }, path: 'mcp.custom.protocol' },
    { source: { agent: { worker: { color: 'red' } } }, path: 'agents.worker.color' },
    { source: { agent: { worker: { model: 'invalid' } } }, path: 'agents.worker.model' },
    { source: { agent: { worker: { model: 'openai/model', variant: 'high#other' } } }, path: 'agents.worker.variant' },
    { source: { agent: { worker: { model: 'openai/model', variant: '' } } }, path: 'agents.worker.variant' },
    { source: { agent: { worker: { temperature: Infinity } } }, path: 'agents.worker.temperature' },
    { source: { snapshot: 'false' }, path: 'snapshot' },
    { source: { default_agent: false }, path: 'default_agent' },
    { source: { default_model: false }, path: 'default_model' },
    { source: { model: 'invalid' }, path: 'model' },
    { source: { model: 'openai/model#high' }, path: 'model' },
    { source: { shell: false }, path: 'shell' },
    { source: { instructions: ['valid.md', false] }, path: 'instructions' },
  ])('fails closed for unsupported input at $path', ({ source, path }) => {
    const result = renderRuntimeConfig(unprotectedModel(source))
    expect(result).toMatchObject({ ok: false, error: { code: 'runtime_config_unsupported', path } })
    expect(result).not.toHaveProperty('data')
  })
})

describe('V2 runtime config renderer: session scratch folders', () => {
  const scratch = { root: '/tmp/arche-scratch', workspaceRoot: '/workspace' }
  const source = {
    default_agent: 'writer',
    agent: {
      writer: { tools: { read: true, write: true, edit: true } },
      reader: { mode: 'subagent', tools: { read: true } },
    },
  }

  it('requires the session-aware guard for scratch while keeping the vault and other paths guarded', () => {
    const rendered = config({ ...createRuntimeConfigModel(source), scratch })
    const writer = agentConfig(rendered, 'writer').permissions
    const reader = agentConfig(rendered, 'reader').permissions

    // OpenCode 2 matches edit on the workspace-relative path and external_directory on the absolute one.
    expect(decision(writer, 'edit', '../tmp/arche-scratch/ses_1/draft.md')).toBe('allow')
    expect(decision(writer, 'edit', 'notes.md')).toBe('deny')
    expect(decision(writer, 'edit', '../etc/hosts')).toBe('deny')
    expect(decision(writer, 'edit', '/tmp/arche-scratch/ses_1/draft.md')).toBe('allow')
    expect(decision(writer, 'external_directory', '/tmp/arche-scratch/ses_1/draft.md')).toBe('ask')
    expect(decision(writer, 'external_directory', '/etc/hosts')).toBe('ask')
    expect(decision(reader, 'edit', '../tmp/arche-scratch/ses_1/draft.md')).toBe('deny')
    expect(decision(reader, 'external_directory', '/tmp/arche-scratch/ses_1/draft.md')).toBe('ask')
    expect(decision(rendered.permissions, 'external_directory', '/tmp/arche-scratch/ses_1')).toBe('ask')
    expect(rendered.plugins).toEqual([{ package: '/opt/arche/arche-tools/shared/scratch-isolation', options: { root: scratch.root } }])
    expect(decision(rendered.policies, 'tool.use', 'edit:../tmp/arche-scratch/ses_1/draft.md')).toBe('allow')
    expect(decision(rendered.policies, 'tool.use', 'edit:/tmp/arche-scratch/ses_1/draft.md')).toBe('allow')
    expect(decision(rendered.policies, 'tool.use', 'edit:notes.md')).toBe('deny')
    expect(decision(rendered.policies, 'tool.use', 'edit:.opencode/opencode.json')).toBe('deny')
  })

  it('derives the workspace-relative pattern from both roots', () => {
    const rendered = config({ ...createRuntimeConfigModel(source), scratch: { root: '/var/tmp/scratch/', workspaceRoot: '/Users/me/vault/workspace' } })
    expect(decision(agentConfig(rendered, 'writer').permissions, 'edit', '../../../../var/tmp/scratch/ses_1/a.md')).toBe('allow')
  })

  it.each([
    { scratch, sha: '1230f2b37252f09a340930e7a1f8aa18083a11a267582373578df5f2fa424c69' },
    { scratch: { root: '/var/tmp/scratch/', workspaceRoot: '/Users/me/vault/workspace' }, sha: 'a91005113c56f440c691c9cadf4bc0e62f90e308e4b6863a0da131b4ac06c456' },
  ])('keeps POSIX scratch output stable for $scratch', ({ scratch, sha }) => {
    const result = renderRuntimeConfig({ ...createRuntimeConfigModel(source), scratch })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(createHash('sha256').update(result.data.opencodeConfigContent).digest('hex')).toBe(sha)
  })

  it.each([
    { root: 'C:/Users/Ada/Temp/arche-scratch/', workspaceRoot: 'C:/Users/Ada/Vault/workspace', relative: '../../Temp/arche-scratch' },
    { root: String.raw`C:\Users\Ada\Temp\arche-scratch`, workspaceRoot: String.raw`C:\Users\Ada\Vault\workspace`, relative: '../../Temp/arche-scratch' },
    { root: 'C:/Users/Ada/Temp/arche-scratch', workspaceRoot: 'D:/Vault/workspace', relative: 'C:/Users/Ada/Temp/arche-scratch' },
  ])('renders Windows scratch resources for $workspaceRoot', ({ root, workspaceRoot, relative }) => {
    const absolute = 'C:/Users/Ada/Temp/arche-scratch'
    const rendered = config({ ...createRuntimeConfigModel(source), scratch: { root, workspaceRoot } })
    const writer = agentConfig(rendered, 'writer').permissions
    const reader = agentConfig(rendered, 'reader').permissions
    const editRules = rules(writer).filter((rule) => rule.action === 'edit' && rule.resource.includes('arche-scratch'))

    expect(editRules.map((rule) => rule.resource)).toEqual([...new Set([`${relative}/*`, `${absolute}/*`])])
    for (const resource of new Set([`${relative}/ses_1/draft.md`, `${absolute}/ses_1/draft.md`])) {
      expect(decision(writer, 'edit', resource)).toBe('allow')
      expect(decision(reader, 'edit', resource)).toBe('deny')
      expect(decision(rendered.policies, 'tool.use', `edit:${resource}`)).toBe('allow')
    }
    for (const permissions of [writer, reader, rendered.permissions]) {
      expect(decision(permissions, 'external_directory', `${absolute}/ses_1/*`)).toBe('ask')
      expect(decision(permissions, 'external_directory', 'C:/Users/Ada/Temp/other/*')).toBe('ask')
    }
    for (const resource of ['notes.md', '.opencode/opencode.json', 'C:/Users/Ada/Temp/other/draft.md', '../other/draft.md']) {
      expect(decision(writer, 'edit', resource)).toBe('deny')
      expect(decision(rendered.policies, 'tool.use', `edit:${resource}`)).toBe('deny')
    }
    expect(JSON.stringify(rendered)).not.toContain('\\\\')
  })

  it.each(['/bundle with spaces/arche-tools/server.js', String.raw`C:\Arche\bin\arche-tools\server.js`])('loads the isolation guard from the bundled tools next to %s', (entry) => {
    const rendered = config({ ...createRuntimeConfigModel({ ...source, mcp: { arche_tools: { type: 'local', command: ['node', entry] } } }), scratch })
    expect(rendered.plugins).toEqual([{ package: entry.replaceAll('\\', '/').replace('/server.js', '/shared/scratch-isolation'), options: { root: scratch.root } }])
  })

  it('adds no scratch rules without a scratch folder', () => {
    const rendered = config(createRuntimeConfigModel(source))
    const scratchRules = [rendered.permissions, rendered.policies, ...['writer', 'reader'].map((id) => agentConfig(rendered, id).permissions)]
      .flatMap((value) => rules(value)).filter((rule) => rule.resource.includes('scratch'))
    expect(scratchRules).toEqual([])
    expect(decision(rendered.policies, 'tool.use', 'edit:../tmp/arche-scratch/ses_1/draft.md')).toBe('deny')
  })

  it.each([
    [{ root: 'tmp/arche-scratch', workspaceRoot: '/workspace' }, 'scratch.root'],
    [{ root: '/tmp/*', workspaceRoot: '/workspace' }, 'scratch.root'],
    [{ root: '/tmp/arche-scratch', workspaceRoot: 'workspace' }, 'scratch.workspaceRoot'],
    [{ root: '/workspace/scratch', workspaceRoot: '/workspace' }, 'scratch.root'],
    [{ root: '/workspace', workspaceRoot: '/workspace' }, 'scratch.root'],
    [{ root: 'C:Temp/scratch', workspaceRoot: 'C:/Vault/workspace' }, 'scratch.root'],
    [{ root: 'C:/Temp/*', workspaceRoot: 'C:/Vault/workspace' }, 'scratch.root'],
    [{ root: 'C:/Temp/scratch', workspaceRoot: 'C:Vault/workspace' }, 'scratch.workspaceRoot'],
    [{ root: 'c:/VAULT/workspace/scratch', workspaceRoot: 'C:/Vault/workspace' }, 'scratch.root'],
    [{ root: 'C:/Vault/workspace', workspaceRoot: 'C:/Vault/workspace' }, 'scratch.root'],
  ])('rejects scratch folder %j', (invalid, path) => {
    const result = renderRuntimeConfig({ ...createRuntimeConfigModel(source), scratch: invalid })
    expect(result).toMatchObject({ ok: false, error: { code: 'runtime_config_unsupported', path } })
  })
})

describe('V2 runtime config renderer: spilled tool output', () => {
  const toolOutputDirectory = '/home/workspace/.local/share/opencode/tool-output'
  const source = {
    default_agent: 'writer',
    agent: {
      writer: { tools: { read: true, write: true, edit: true } },
      reader: { mode: 'subagent', tools: { read: true } },
    },
  }
  const externalDirectoryRules = (value: unknown) => rules(value).filter((rule) => rule.action === 'external_directory')

  it('allows only the tool-output directory after the ask, globally and per agent', () => {
    const rendered = config({ ...createRuntimeConfigModel(source), toolOutputDirectory })
    const scopes = [rendered.permissions, agentConfig(rendered, 'writer').permissions, agentConfig(rendered, 'reader').permissions]

    for (const permissions of scopes) {
      expect(externalDirectoryRules(permissions)).toEqual([
        { action: 'external_directory', resource: '*', effect: 'ask' },
        { action: 'external_directory', resource: `${toolOutputDirectory}/*`, effect: 'allow' },
      ])
      expect(decision(permissions, 'external_directory', `${toolOutputDirectory}/*`)).toBe('allow')
      expect(decision(permissions, 'external_directory', `${toolOutputDirectory}/tool_1`)).toBe('allow')
      expect(decision(permissions, 'external_directory', '/home/workspace/.local/share/opencode/auth.json')).toBe('ask')
      expect(decision(permissions, 'external_directory', '/etc/hosts')).toBe('ask')
    }
  })

  it('keeps the ask and the tool-output allow last when an agent authors its own external directory rules', () => {
    const rendered = config({
      ...createRuntimeConfigModel({
        default_agent: 'writer',
        permission: { external_directory: { '/srv/*': 'deny', [`${toolOutputDirectory}/private/*`]: 'deny' } },
        agent: {
          writer: {
            tools: { read: true, external_directory: true },
            permission: { external_directory: { '/data/*': 'deny', [`${toolOutputDirectory}/*`]: 'deny' } },
          },
        },
      }),
      toolOutputDirectory,
    })
    const writer = agentConfig(rendered, 'writer').permissions

    for (const permissions of [rendered.permissions, writer]) {
      expect(externalDirectoryRules(permissions).slice(-2)).toEqual([
        { action: 'external_directory', resource: '*', effect: 'ask' },
        { action: 'external_directory', resource: `${toolOutputDirectory}/*`, effect: 'allow' },
      ])
      expect(decision(permissions, 'external_directory', `${toolOutputDirectory}/tool_1`)).toBe('allow')
      expect(decision(permissions, 'external_directory', '/etc/hosts')).toBe('ask')
    }
    expect(externalDirectoryRules(writer)).toContainEqual({ action: 'external_directory', resource: '/data/*', effect: 'deny' })
    expect(externalDirectoryRules(writer)).toContainEqual({ action: 'external_directory', resource: `${toolOutputDirectory}/*`, effect: 'deny' })
    expect(externalDirectoryRules(writer)).toContainEqual({ action: 'external_directory', resource: '/srv/*', effect: 'deny' })
  })

  it('normalizes the directory like the scratch absolute pattern', () => {
    const posixRendered = config({ ...createRuntimeConfigModel(source), toolOutputDirectory: `${toolOutputDirectory}/` })
    const windowsRendered = config({ ...createRuntimeConfigModel(source), toolOutputDirectory: String.raw`C:\Users\Ada\data\opencode\tool-output` })

    expect(decision(posixRendered.permissions, 'external_directory', `${toolOutputDirectory}/*`)).toBe('allow')
    expect(externalDirectoryRules(posixRendered.permissions).at(-1)?.resource).toBe(`${toolOutputDirectory}/*`)
    expect(externalDirectoryRules(windowsRendered.permissions).at(-1)).toEqual({
      action: 'external_directory', resource: 'C:/Users/Ada/data/opencode/tool-output/*', effect: 'allow',
    })
  })

  it('renders nothing extra without a tool-output directory', () => {
    const rendered = config(createRuntimeConfigModel(source))

    for (const permissions of [rendered.permissions, agentConfig(rendered, 'writer').permissions, agentConfig(rendered, 'reader').permissions]) {
      expect(externalDirectoryRules(permissions)).toEqual([{ action: 'external_directory', resource: '*', effect: 'ask' }])
    }
  })

  it.each([
    'opencode/tool-output',
    '',
    '/home/*/tool-output',
    '/home/workspace/tool-output?',
    'C:opencode/tool-output',
    'C:/Users/*/tool-output',
  ])('rejects tool-output directory %j', (invalid) => {
    const result = renderRuntimeConfig({ ...createRuntimeConfigModel(source), toolOutputDirectory: invalid })
    expect(result).toMatchObject({ ok: false, error: { code: 'runtime_config_unsupported', path: 'toolOutputDirectory' } })
  })
})

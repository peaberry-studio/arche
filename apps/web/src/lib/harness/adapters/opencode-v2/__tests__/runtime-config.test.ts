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

describe('V2 runtime config renderer', () => {
  it('refuses the required self-delegation guard instead of substituting an overridable permission or global target ban', () => {
    const result = renderRuntimeConfig(createRuntimeConfigModel({
      agent: {
        orchestrator: { mode: 'primary', tools: { task: true } },
        reviewer: { mode: 'subagent', tools: { read: true } },
      },
    }))
    expect(result).toMatchObject({ ok: false, error: { code: 'runtime_config_unsupported', path: 'guards.selfDelegation' } })
    expect(result).not.toHaveProperty('data')
  })

  it.each([
    { name: 'an overridable agent permission', source: { agent: { worker: {
      mode: 'all', tools: { task: true }, permission: { task: { '*': 'allow', worker: 'deny' } },
    } } } },
    { name: 'a global delegation target ban', source: {
      policies: [{ action: 'tool.use', resource: 'subagent:*', effect: 'deny' }],
      agent: { worker: { mode: 'all', tools: { task: true } } },
    } },
    { name: 'a prompt-only delegation constraint', source: { agent: { worker: {
      mode: 'all', tools: { task: true }, prompt: 'Never delegate to yourself.',
    } } } },
  ])('does not mistake $name for the protected caller-scoped guard', ({ source }) => {
    const model = createRuntimeConfigModel(source)
    const original = structuredClone(model)

    const result = renderRuntimeConfig(model)

    expect(result).toMatchObject({ ok: false, error: { code: 'runtime_config_unsupported', path: 'guards.selfDelegation' } })
    expect(result).not.toHaveProperty('data')
    expect(model).toEqual(original)
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
        ollama: { npm: '@ai-sdk/openai-compatible', name: 'Ollama', options: { baseURL: 'https://gateway.example/ollama', apiKey: '{env:TOKEN}' }, models: { coding: { id: 'upstream-coding', name: 'Coding' } } },
        openai: { options: { baseURL: 'https://gateway.example/openai' } },
      },
      agent: { assistant: { mode: 'all', tools: { read: true } } },
    }))

    expect(rendered).toMatchObject({
      snapshots: false,
      mcp: { servers: {
        arche_tools: { type: 'local', command: ['node', '/opt/arche/arche-tools/server.js'], disabled: false, codemode: false },
        arche_linear_1: { type: 'remote', url: 'https://gateway.example/mcp', headers: { Authorization: 'Bearer token' }, oauth: false, disabled: true, timeout: { catalog: 1234, execution: 1234 } },
      } },
      providers: {
        ollama: { package: 'aisdk:@ai-sdk/openai-compatible', settings: { baseURL: 'https://gateway.example/ollama', apiKey: '{env:TOKEN}' }, models: { coding: { modelID: 'upstream-coding', name: 'Coding' } } },
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
    { source: { permission: { doom_loop: 'deny' } }, path: 'access.doom_loop' },
    { source: { permission: { lsp: 'deny' } }, path: 'access.lsp' },
    { source: { permission: { typo: 'deny' } }, path: 'access.typo' },
    { source: { permission: { read: { '*': 'invalid' } } }, path: 'access.read.*' },
    { source: { permission: { read: 'deny', list: 'allow' } }, path: 'access.list' },
    { source: { permission: { bash: { '*': 'deny' }, shell: { '*': 'allow' } } }, path: 'access.shell' },
    { source: { agent: { worker: { permission: { edit: 'ask', write: 'allow' } } } }, path: 'agents.worker.access.write' },
    { source: { agent: { worker: { tools: { read: true, list: false } } } }, path: 'agents.worker.tools.list' },
    { source: { agent: { worker: { tools: { lsp: true } } } }, path: 'agents.worker.tools.lsp' },
    { source: { agent: { worker: { tools: { edit: false, write: true } } } }, path: 'agents.worker.tools.write' },
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

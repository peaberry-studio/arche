import type { RuntimeAgentModel, RuntimeConfigModel, RuntimeConfigRenderResult } from '@/lib/harness/runtime-config'
import { isRecord } from '@/lib/records'
import {
  injectAgentKnowledgePolicy,
  injectAgentToolCallerIdentity,
} from '@/lib/spawner/agent-config-transforms'
import { serializeRuntimeConfig } from '@/lib/spawner/runtime-config'
import { withWorkspacePermissionGuards } from '@/lib/spawner/runtime-config-utils'
import { PRIMARY_AGENT_STEP_LIMIT, SUBAGENT_STEP_LIMIT } from '@/lib/workspace-config'

type Effect = 'allow' | 'ask' | 'deny'
type Rule = { action: string; resource: string; effect: Effect }
type Policy = { action: 'tool.use' | 'provider.use' | 'integration.use'; resource: string; effect: 'allow' | 'deny' }

const ACTIONS: Record<string, string> = {
  '*': '*', bash: 'shell', shell: 'shell', task: 'subagent', subagent: 'subagent',
  write: 'edit', patch: 'edit', edit: 'edit', read: 'read', list: 'read', glob: 'glob', grep: 'grep',
  skill: 'skill', question: 'question', webfetch: 'webfetch', websearch: 'websearch',
  external_directory: 'external_directory', execute: 'execute',
  opencode_list_mcp_resources: 'opencode_list_mcp_resources',
  opencode_read_mcp_resource: 'opencode_read_mcp_resource',
  chart_create: 'arche_tools_chart_create',
  diagram_create: 'arche_tools_diagram_create',
  document_inspect: 'arche_tools_document_inspect',
  email_draft: 'arche_tools_email_draft',
  flow_propose: 'arche_tools_flow_propose',
  learning_propose: 'arche_tools_learning_propose',
  presentation_inspect: 'arche_tools_presentation_inspect',
  session_history_query: 'arche_tools_session_history_query',
  spreadsheet_inspect: 'arche_tools_spreadsheet_inspect',
  spreadsheet_sample: 'arche_tools_spreadsheet_sample',
  spreadsheet_query: 'arche_tools_spreadsheet_query',
  spreadsheet_stats: 'arche_tools_spreadsheet_stats',
}

class UnsupportedConfig extends Error {
  constructor(readonly path: string, message: string) { super(message) }
}

function unsupported(path: string, message = 'Unsupported configuration'): never {
  throw new UnsupportedConfig(path, message)
}

function record(value: unknown, path: string): Record<string, unknown> {
  return isRecord(value) ? value : unsupported(path, 'Expected an object')
}

function effect(value: unknown, path: string): Effect {
  return value === 'allow' || value === 'ask' || value === 'deny' ? value : unsupported(path, 'Invalid permission effect')
}

function action(name: string, path: string): string {
  return ACTIONS[name] ?? (/^arche_[\w*?-]+$/.test(name) ? name : unsupported(path, `No documented V2 action for ${name}`))
}

function matches(pattern: string, value: string): boolean {
  return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(value)
}

function orderedEntries(value: Record<string, unknown>): [string, unknown][] {
  return Object.entries(value).sort(([left], [right]) => {
    const specificity = (key: string) => key === '*' ? -1 : /[*?]/.test(key) ? 0 : 1
    return specificity(left) - specificity(right)
  })
}

function permissionRules(value: unknown, path: string): Rule[] {
  if (value === undefined) return []
  if (typeof value === 'string') return [{ action: '*', resource: '*', effect: effect(value, path) }]
  const aliases = new Map<string, Rule[]>()
  return orderedEntries(record(value, path)).flatMap(([key, entry]) => {
    const target = action(key, `${path}.${key}`)
    const rules = typeof entry === 'string'
      ? [{ action: target, resource: '*', effect: effect(entry, `${path}.${key}`) }]
      : orderedEntries(record(entry, `${path}.${key}`)).map(([resource, entryEffect]) => ({
        action: target, resource, effect: effect(entryEffect, `${path}.${key}.${resource}`),
      }))
    const previous = aliases.get(target)
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(rules)) unsupported(`${path}.${key}`, 'V2 merges permission actions with conflicting rules')
    aliases.set(target, rules)
    return rules
  })
}

function toolRules(value: unknown, permissions: Rule[], path: string, allowlist: boolean): Rule[] {
  if (value === undefined) return permissions
  const tools = record(value, path)
  const rules: Rule[] = allowlist ? [{ action: '*', resource: '*', effect: 'deny' }] : [...permissions]
  const aliases = new Map<string, boolean>()
  for (const [tool, enabled] of orderedEntries(tools)) {
    if (typeof enabled !== 'boolean') unsupported(`${path}.${tool}`, 'Expected a tool boolean')
    const target = action(tool, `${path}.${tool}`)
    const previous = aliases.get(target)
    if (previous !== undefined && previous !== enabled) unsupported(`${path}.${tool}`, 'V2 merges tool actions with conflicting grants')
    aliases.set(target, enabled)
    rules.push({ action: target, resource: '*', effect: enabled ? 'allow' : 'deny' })
    if (enabled) {
      rules.push(...permissions.filter((rule) => matches(rule.action, target)).map((rule) => ({ ...rule, action: target })))
    }
  }
  return rules
}

function renderAgent(agent: RuntimeAgentModel, model: RuntimeConfigModel, globalRules: Rule[]): Record<string, unknown> {
  const path = `agents.${agent.id}`
  if (agent.invalidDefinition) unsupported(path, 'Expected an agent object')
  if (!agent.id || /[*?]/.test(agent.id)) unsupported(path, 'Agent id cannot express a safe exact delegation guard')
  const settings = { ...agent.settings }
  const allowed = new Set(['description', 'display_name', 'mode', 'variant', 'disable', 'hidden', 'color', 'steps', 'maxSteps', 'temperature', 'top_p', 'options'])
  for (const key of Object.keys(settings)) if (!allowed.has(key)) unsupported(`${path}.${key}`)
  for (const key of ['disable', 'hidden']) if (settings[key] !== undefined && typeof settings[key] !== 'boolean') unsupported(`${path}.${key}`)
  for (const key of ['description', 'color']) if (settings[key] !== undefined && typeof settings[key] !== 'string') unsupported(`${path}.${key}`)
  if (typeof settings.color === 'string' && !/^#[0-9a-fA-F]{6}$/.test(settings.color)) unsupported(`${path}.color`)
  const mode = agent.id === model.modelDefaults.agent ? 'primary' : settings.mode ?? 'all'
  if (mode !== 'primary' && mode !== 'subagent' && mode !== 'all') unsupported(`${path}.mode`)
  const primary = mode === 'primary'
  const limit = primary ? PRIMARY_AGENT_STEP_LIMIT : SUBAGENT_STEP_LIMIT
  const configuredSteps = settings.steps ?? settings.maxSteps ?? limit
  if (typeof configuredSteps !== 'number' || !Number.isInteger(configuredSteps) || configuredSteps < 1) unsupported(`${path}.steps`)
  const defaultModel = typeof model.modelDefaults.model === 'string' ? model.modelDefaults.model.trim() || undefined : model.modelDefaults.model
  const reference = typeof agent.model === 'string' ? agent.model.trim() || defaultModel : agent.model ?? defaultModel
  if (reference !== undefined && (typeof reference !== 'string' || !/^[^/#]+\/[^#]+(?:#[^#]+)?$/.test(reference))) unsupported(`${path}.model`)
  if (settings.variant !== undefined && (typeof settings.variant !== 'string' || !settings.variant || settings.variant.includes('#') || !reference || String(reference).includes('#'))) unsupported(`${path}.variant`)
  if (agent.instructions !== undefined && typeof agent.instructions !== 'string') unsupported(`${path}.instructions`)
  let promptConfig: Record<string, unknown> = { agent: { [agent.id]: { prompt: agent.instructions ?? '' } } }
  promptConfig = injectAgentToolCallerIdentity(promptConfig)
  promptConfig = injectAgentKnowledgePolicy(promptConfig)
  const prompt = record(record(promptConfig.agent, path)[agent.id], path).prompt
  const ownRules = permissionRules(agent.access, `${path}.access`)
  const permissions = toolRules(agent.tools, [...globalRules, ...ownRules], `${path}.tools`, true)
  permissions.push({ action: 'external_directory', resource: '*', effect: 'ask' })
  if (model.guards.execution && !primary) permissions.push({ action: 'subagent', resource: '*', effect: 'deny' })
  if (model.guards.knowledgeWrites) permissions.push({ action: 'edit', resource: '*', effect: 'deny' })
  const body = settings.options === undefined ? {} : { ...record(settings.options, `${path}.options`) }
  for (const key of ['temperature', 'top_p']) {
    if (settings[key] !== undefined && (typeof settings[key] !== 'number' || !Number.isFinite(settings[key]))) unsupported(`${path}.${key}`)
    if (settings[key] !== undefined) body[key] = settings[key]
  }
  return {
    ...Object.fromEntries(['description', 'hidden', 'color'].filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]])),
    mode,
    system: prompt,
    ...(reference === undefined ? {} : { model: `${reference}${settings.variant ? `#${settings.variant}` : ''}` }),
    ...(settings.disable === undefined ? {} : { disabled: settings.disable }),
    ...(Object.keys(body).length ? { request: { body } } : {}),
    ...(model.guards.execution ? { steps: Math.min(configuredSteps, limit) } : { steps: configuredSteps }),
    permissions,
  }
}

function renderMcp(targets: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(targets).map(([id, value]) => {
    const path = `mcp.${id}`
    const { enabled, timeout, ...server } = record(value, path)
    if (server.type !== 'local' && server.type !== 'remote') unsupported(`${path}.type`)
    if (id === 'arche_tools' && server.type !== 'local') unsupported(`${path}.type`, 'Built-in tools require a local stdio server')
    const allowed = new Set(['type', 'codemode', 'protocol', ...(server.type === 'local' ? ['command', 'environment', 'cwd'] : ['url', 'headers', 'oauth'])])
    for (const key of Object.keys(server)) if (!allowed.has(key)) unsupported(`${path}.${key}`)
    if (enabled !== undefined && typeof enabled !== 'boolean') unsupported(`${path}.enabled`)
    if (timeout !== undefined && (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout <= 0)) unsupported(`${path}.timeout`)
    if (server.type === 'local' && (!Array.isArray(server.command) || !server.command.length || !server.command.every((item) => typeof item === 'string'))) unsupported(`${path}.command`)
    if (server.type === 'remote' && typeof server.url !== 'string') unsupported(`${path}.url`)
    if (server.cwd !== undefined && typeof server.cwd !== 'string') unsupported(`${path}.cwd`)
    if (server.codemode !== undefined && typeof server.codemode !== 'boolean') unsupported(`${path}.codemode`)
    if (server.protocol !== undefined && server.protocol !== 'legacy' && server.protocol !== 'auto' && server.protocol !== '2026-07-28') unsupported(`${path}.protocol`)
    for (const key of ['environment', 'headers']) {
      if (server[key] === undefined) continue
      for (const [name, entry] of Object.entries(record(server[key], `${path}.${key}`))) {
        if (typeof entry !== 'string') unsupported(`${path}.${key}.${name}`)
      }
    }
    if (server.oauth !== undefined && server.oauth !== false) unsupported(`${path}.oauth`, 'OAuth object migration requires an explicit supported mapping')
    return [id, {
      ...server,
      ...(enabled === undefined ? {} : { disabled: !enabled }),
      ...(timeout === undefined ? {} : { timeout: { catalog: timeout, execution: timeout } }),
      ...(id === 'arche_tools' ? { codemode: false } : {}),
    }]
  }))
}

function renderProviders(targets: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(targets).map(([id, value]) => {
    const path = `providers.${id}`
    const { npm, options, api, models, ...provider } = record(value, path)
    for (const key of Object.keys(provider)) if (!['name', 'env'].includes(key)) unsupported(`${path}.${key}`)
    if (provider.name !== undefined && typeof provider.name !== 'string') unsupported(`${path}.name`)
    if (provider.env !== undefined && (!Array.isArray(provider.env) || !provider.env.every((entry) => typeof entry === 'string'))) unsupported(`${path}.env`)
    if (npm !== undefined && typeof npm !== 'string') unsupported(`${path}.npm`)
    const settings = options === undefined ? {} : { ...record(options, `${path}.options`) }
    for (const key of Object.keys(settings)) if (!['baseURL', 'apiKey', 'timeout', 'headerTimeout', 'chunkTimeout'].includes(key)) unsupported(`${path}.options.${key}`, 'Provider option has no verified request-role mapping')
    for (const key of ['baseURL', 'apiKey']) if (settings[key] !== undefined && typeof settings[key] !== 'string') unsupported(`${path}.options.${key}`)
    for (const key of ['timeout', 'headerTimeout', 'chunkTimeout']) {
      if (settings[key] !== undefined && settings[key] !== false && (typeof settings[key] !== 'number' || !Number.isFinite(settings[key]))) unsupported(`${path}.options.${key}`)
    }
    if (api !== undefined) {
      if (typeof api !== 'string' || settings.baseURL !== undefined) unsupported(`${path}.api`)
      settings.baseURL = api
    }
    const renderedModels = models === undefined ? undefined : Object.fromEntries(Object.entries(record(models, `${path}.models`)).map(([modelId, entry]) => {
      const definition = record(entry, `${path}.models.${modelId}`)
      for (const key of Object.keys(definition)) if (!['name', 'id', 'limit'].includes(key)) unsupported(`${path}.models.${modelId}.${key}`)
      for (const key of ['name', 'id']) if (definition[key] !== undefined && typeof definition[key] !== 'string') unsupported(`${path}.models.${modelId}.${key}`)
      if (definition.limit !== undefined) {
        for (const [key, value] of Object.entries(record(definition.limit, `${path}.models.${modelId}.limit`))) {
          if (!['context', 'input', 'output'].includes(key) || typeof value !== 'number' || !Number.isInteger(value)) unsupported(`${path}.models.${modelId}.limit.${key}`)
        }
      }
      const { id: upstreamId, ...rest } = definition
      return [modelId, { ...rest, ...(upstreamId === undefined ? {} : { modelID: upstreamId }) }]
    }))
    return [id, {
      ...provider,
      ...(typeof npm === 'string' ? { package: npm.startsWith('@ai-sdk/') ? `aisdk:${npm}` : npm } : {}),
      settings,
      ...(renderedModels === undefined ? {} : { models: renderedModels }),
    }]
  }))
}

function renderPolicies(value: unknown): Policy[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) unsupported('policies')
  return value.map((entry, index) => {
    const statement = record(entry, `policies.${index}`)
    if (Object.keys(statement).some((key) => !['action', 'resource', 'effect'].includes(key))) unsupported(`policies.${index}`)
    const { action, resource, effect } = statement
    if (action !== 'tool.use' && action !== 'provider.use' && action !== 'integration.use') unsupported(`policies.${index}.action`)
    if (typeof resource !== 'string' || (effect !== 'allow' && effect !== 'deny')) unsupported(`policies.${index}`)
    return { action, resource, effect }
  })
}

export function renderRuntimeConfig(model: RuntimeConfigModel): RuntimeConfigRenderResult {
  try {
    if (model.guards.selfDelegation) {
      unsupported('guards.selfDelegation', 'V2 policies cannot scope delegation restrictions to the caller; per-agent permissions are overridable')
    }
    const { policies: authoredPolicies, snapshot, ...settings } = model.settings
    const allowed = new Set(['$schema', 'model', 'instructions', 'watcher', 'shell', 'tool_output'])
    for (const key of Object.keys(settings)) if (!allowed.has(key)) unsupported(key)
    if (snapshot !== undefined && typeof snapshot !== 'boolean') unsupported('snapshot')
    if (model.modelDefaults.agent !== undefined && typeof model.modelDefaults.agent !== 'string') unsupported('default_agent')
    if (model.modelDefaults.model !== undefined && typeof model.modelDefaults.model !== 'string') unsupported('default_model')
    if (settings.model !== undefined && (typeof settings.model !== 'string' || !/^[^/#]+\/[^#]+$/.test(settings.model))) unsupported('model', 'Root models require a provider/model reference without a variant')
    if (settings.shell !== undefined && typeof settings.shell !== 'string') unsupported('shell')
    if (settings.instructions !== undefined && (!Array.isArray(settings.instructions) || !settings.instructions.every((entry) => typeof entry === 'string'))) unsupported('instructions')
    const globalRules = toolRules(model.tools, permissionRules(model.access, 'access'), 'tools', false)
    globalRules.push({ action: 'external_directory', resource: '*', effect: 'ask' })
    const policies = renderPolicies(authoredPolicies)
    if (model.guards.workspace) {
      const guarded = withWorkspacePermissionGuards({})
      for (const rule of permissionRules(guarded.permission, 'guards.workspace')) {
        policies.push({ action: 'tool.use', resource: `${rule.action}:${rule.resource}`, effect: 'deny' })
      }
    }
    if (model.guards.knowledgeWrites) policies.push({ action: 'tool.use', resource: 'edit:*', effect: 'deny' })
    const config: Record<string, unknown> = {
      ...settings,
      $schema: 'https://opencode.ai/config.json',
      ...(snapshot === undefined ? {} : { snapshots: snapshot }),
      ...(model.modelDefaults.agent === undefined ? {} : { default_agent: model.modelDefaults.agent }),
      mcp: { servers: renderMcp(model.connectorTargets) },
      providers: renderProviders(model.providerTargets),
      agents: Object.fromEntries((model.agents ?? []).map((agent) => [agent.id, renderAgent(agent, model, globalRules)])),
      permissions: globalRules,
      policies,
    }
    return { ok: true, data: {
      config,
      opencodeConfigContent: serializeRuntimeConfig(config),
      agentsMd: model.agentsMd,
      skills: model.skills,
      skillDirectory: '.opencode/skills',
    } }
  } catch (error) {
    if (!(error instanceof UnsupportedConfig)) throw error
    return { ok: false, error: { code: 'runtime_config_unsupported', path: error.path, message: error.message } }
  }
}

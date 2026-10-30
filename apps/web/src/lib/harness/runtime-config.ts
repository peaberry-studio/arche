import { isRecord } from '@/lib/records'
import type { SkillBundle } from '@/lib/skills/types'

export type RuntimeAgentModel = {
  id: string
  invalidDefinition?: { value: unknown }
  instructions?: unknown
  model?: unknown
  access?: unknown
  tools?: unknown
  settings: Record<string, unknown>
}

export type RuntimeConfigModel = {
  agents?: RuntimeAgentModel[]
  modelDefaults: { agent?: unknown; model?: unknown }
  connectorTargets?: Record<string, unknown>
  providerTargets?: Record<string, unknown>
  access?: unknown
  tools?: unknown
  settings: Record<string, unknown>
  agentsMd?: string
  skills: SkillBundle[]
  guards: { knowledgeWrites: boolean; execution: boolean; workspace: boolean; selfDelegation: boolean }
  // One scratch folder per session lives under this absolute directory, outside
  // the Knowledge Base; agents may read, write and edit there without asking.
  scratch?: { root: string; workspaceRoot: string }
  toolOutputDirectory?: string
}

export type RenderedRuntimeConfig = {
  config: Record<string, unknown>
  opencodeConfigContent: string
  agentsMd?: string
  skills: SkillBundle[]
  skillDirectory: string
}

export type RuntimeConfigRenderResult =
  | { ok: true; data: RenderedRuntimeConfig }
  | { ok: false; error: { code: 'runtime_config_unsupported'; path: string; message: string } }

export class RuntimeConfigRenderError extends Error {
  readonly code = 'runtime_config_unsupported'

  constructor(readonly detail: Extract<RuntimeConfigRenderResult, { ok: false }>['error']) {
    super(`${detail.code}: ${detail.path}: ${detail.message}`)
  }
}

export function createRuntimeConfigModel(
  config: Record<string, unknown>,
  files: { agentsMd?: string; skills?: SkillBundle[] } = {},
): RuntimeConfigModel {
  const { agent, default_agent, default_model, mcp, provider, permission, tools, ...settings } = config
  if (agent !== undefined && !isRecord(agent)) settings.agent = agent
  if (mcp !== undefined && !isRecord(mcp)) settings.mcp = mcp
  if (provider !== undefined && !isRecord(provider)) settings.provider = provider
  return {
    ...(isRecord(agent) ? {
      agents: Object.entries(agent).map(([id, value]) => {
        if (!isRecord(value)) return { id, settings: {}, invalidDefinition: { value } }
        const { prompt, model, permission: access, tools: agentTools, ...agentSettings } = value
        return { id, instructions: prompt, model, access, tools: agentTools, settings: agentSettings }
      }),
    } : {}),
    modelDefaults: { agent: default_agent, model: default_model },
    ...(isRecord(mcp) ? { connectorTargets: mcp } : {}),
    ...(isRecord(provider) ? { providerTargets: provider } : {}),
    access: permission,
    tools,
    settings,
    agentsMd: files.agentsMd,
    skills: files.skills ?? [],
    guards: { knowledgeWrites: true, execution: true, workspace: true, selfDelegation: true },
  }
}

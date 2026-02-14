import {
  OPENCODE_AGENT_TOOLS,
  type OpenCodeAgentToolId,
} from '@/lib/agent-capabilities'
import {
  type CommonAgentConfig,
  type CommonWorkspaceConfig,
  validateCommonWorkspaceConfig,
} from '@/lib/workspace-config'
import { getKickstartAgentById } from '@/kickstart/agents/catalog'
import { renderKickstartKbSkeleton, renderKickstartText } from '@/kickstart/render'
import type {
  KickstartApplyArtifacts,
  KickstartNormalizedApplyInput,
} from '@/kickstart/types'

type BuildKickstartResult =
  | { ok: true; artifacts: KickstartApplyArtifacts }
  | { ok: false; error: 'invalid_payload'; message: string }

type ResolvedAgent = {
  id: string
  displayName: string
  description: string
  model: string
  prompt: string
  temperature: number
  tools: OpenCodeAgentToolId[]
}

function buildToolsConfig(enabledTools: OpenCodeAgentToolId[]): Record<string, boolean> {
  const selected = new Set(enabledTools)
  const config: Record<string, boolean> = {}

  for (const toolId of OPENCODE_AGENT_TOOLS) {
    config[toolId] = selected.has(toolId)
  }

  config['arche_*'] = false
  return config
}

function resolveAgentSelection(input: KickstartNormalizedApplyInput): ResolvedAgent[] {
  return input.agents.flatMap((selection) => {
    const definition = getKickstartAgentById(selection.id)
    if (!definition) return []

    const model =
      selection.modelOverride ??
      input.template.recommendedModels[selection.id] ??
      definition.recommendedModel

    const promptSource =
      selection.promptOverride ??
      input.template.promptOverrides[selection.id] ??
      definition.systemPrompt
    const prompt = renderKickstartText(promptSource, input.context)

    return [
      {
        id: definition.id,
        displayName: definition.displayName,
        description: definition.description,
        model,
        prompt,
        temperature: selection.temperatureOverride ?? definition.temperature,
        tools: definition.tools,
      },
    ]
  })
}

function buildConfig(agents: ResolvedAgent[]): CommonWorkspaceConfig {
  const defaultAgentId = agents.some((agent) => agent.id === 'assistant')
    ? 'assistant'
    : agents[0]?.id

  const configAgents = agents.reduce<Record<string, CommonAgentConfig>>((acc, agent) => {
    acc[agent.id] = {
      display_name: agent.displayName,
      description: agent.description,
      mode: agent.id === defaultAgentId ? 'primary' : 'subagent',
      model: agent.model,
      temperature: agent.temperature,
      prompt: agent.prompt,
      tools: buildToolsConfig(agent.tools),
    }
    return acc
  }, {})

  return {
    $schema: 'https://opencode.ai/config.json',
    default_agent: defaultAgentId,
    agent: configAgents,
  }
}

function buildAgentsMarkdown(
  input: KickstartNormalizedApplyInput,
  agents: ResolvedAgent[]
): string {
  const renderedTemplate = renderKickstartText(input.template.agentsMdTemplate, input.context).trim()

  const activeAgentLines = agents.map(
    (agent) => `- \`${agent.id}\` (${agent.displayName}) - ${agent.description}`
  )

  const sharedRules = [
    '- The primary `assistant` delegates learn/remember/store requests to `knowledge-curator`.',
    '- The `assistant` suggests saving high-value new knowledge and asks for confirmation first.',
    '- The `knowledge-curator` must ask for explicit confirmation before any KB write.',
  ]

  return [
    renderedTemplate,
    '',
    '## Active Agents',
    ...activeAgentLines,
    '',
    '## Shared Behavior Rules',
    ...sharedRules,
    '',
  ].join('\n')
}

export function buildKickstartArtifacts(
  input: KickstartNormalizedApplyInput
): BuildKickstartResult {
  const resolvedAgents = resolveAgentSelection(input)
  if (resolvedAgents.length === 0) {
    return {
      ok: false,
      error: 'invalid_payload',
      message: 'no valid agents were selected',
    }
  }

  const config = buildConfig(resolvedAgents)
  const validation = validateCommonWorkspaceConfig(config)
  if (!validation.ok) {
    return {
      ok: false,
      error: 'invalid_payload',
      message: validation.error ?? 'invalid kickstart config',
    }
  }

  const renderedKb = renderKickstartKbSkeleton(input.template, input.context)
  const agentsMdContent = buildAgentsMarkdown(input, resolvedAgents)

  return {
    ok: true,
    artifacts: {
      configContent: JSON.stringify(config, null, 2),
      agentsMdContent,
      kbDirectories: renderedKb.directories,
      kbFiles: renderedKb.files,
    },
  }
}

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
      input.template.agentOverrides[selection.id]?.model ??
      definition.recommendedModel

    const promptSource =
      selection.promptOverride ??
      input.template.agentOverrides[selection.id]?.prompt ??
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

  const markdownCapabilityLines = [
    'Equations:',
    '- Render math with `$...$` (inline) and `$$...$$` (display). LaTeX `\\[...\\]` (display) and `\\(...\\)` (inline) delimiters also render.',
    '- KaTeX supports the standard LaTeX math subset.',
    '',
    'Plots (Vega-Lite):',
    '- Use ` ```vega-lite ` fenced code blocks with a raw Vega-Lite JSON spec for in-document charts (KB articles, reports, research notes).',
    '- Use the `chart_create` tool only for quick ad-hoc chat visualizations — for anything that persists in a document, use fenced specs.',
    '- Allowed marks: `bar`, `line`, `area`, `point`, `arc`, `rule`, `rect`, `text`, `tick`, `errorband`, `errorbar`, `circle`, `square`, `trail`.',
    '- Supported top-level keys: `$schema`, `autosize`, `data`, `encoding`, `height`, `mark`, `title`, `width`, `layer`, `transform`, `resolve`, `spacing`.',
    '- Data must be inline (`data.values` as an array of row objects). No URLs, no `url`/`href`/`src` keys. Maximum 1000 rows and 50 columns.',
    '- Invalid specs render as a code block with an error note — always validate JSON before emitting.',
    '',
    'Publication-quality chart checklist:',
    '- Match the mark to the data relationship: `line` for continuous trends over time, `bar` for categorical comparison, `point`/`circle` for correlation, `area` for cumulative magnitude, `arc` (pie) only for part-to-whole with at most 5 categories, `rule` for reference lines/thresholds, `errorbar`/`errorband` for uncertainty intervals, `text` for annotations.',
    '- Label every axis with quantity AND unit (e.g. "Latency (ms)", not just "Latency").',
    '- Include a descriptive chart title.',
    '- Number figures ("Figure 1", "Figure 2") and reference them from the surrounding prose.',
    '- Precede each figure with a sentence stating what it shows; follow with interpretation.',
    '- Use correct encoding types: `temporal` for dates, `quantitative` for measures, `nominal`/`ordinal` for categories.',
    '- Bar chart y-axes must start at zero (do not truncate to mislead).',
    '- Group into "Other" when there are more than 7 categories.',
    '- Prefer direct labels over legends when there are few series.',
    '- Keep data inline; cite provenance in the prose around the figure.',
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
    '## Markdown Capabilities',
    ...markdownCapabilityLines,
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

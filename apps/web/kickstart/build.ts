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
    '- **The complete Vega-Lite grammar is supported.** Anything valid per https://vega.github.io/vega-lite/docs/ renders, with no Arche-specific subset to work around.',
    '- That includes every mark (`arc`, `area`, `bar`, `boxplot`, `circle`, `errorband`, `errorbar`, `geoshape`, `image`, `line`, `point`, `rect`, `rule`, `square`, `text`, `tick`, `trail`), multi-view composition (`layer`, `facet`, `repeat`, `hconcat`, `vconcat`, `concat`), every transform (`aggregate`, `bin`, `calculate`, `density`, `extent`, `filter`, `flatten`, `fold`, `impute`, `joinaggregate`, `loess`, `lookup`, `pivot`, `quantile`, `regression`, `sample`, `stack`, `timeUnit`, `window`), interactivity via `params`/selections with `bind` to legends, inputs and scales, geographic `projection`, `datasets`, `config`, `resolve`, and Vega expressions.',
    '- Interaction is live in the app: tooltips, hover, pan/zoom, brushing and cross-filtering all work. Charts also expose an export menu (PNG/SVG).',
    '- Top-level `params` works — do not nest selections inside `layer[0]` as a workaround.',
    '- Data: inline `data.values` is the default and always works. A `data.url` may reference a file inside this workspace by relative path (for example `data/latency.csv`); absolute/remote URLs are not fetched. A referenced file must stay under 8 MB.',
    '- `image` marks: embed the image as an inline `data:` URI. Workspace-relative image paths render in the app but come out broken in PDF export.',
    '- Safety limits, which are not feature restrictions: a spec may not exceed 8 MB, 200k inline rows (counting `data.values`, named `datasets`, GeoJSON features and generated `sequence` rows), 400 repeated views, 1000 composition branches, or 10,000 pixels in either dimension. `javascript:` links are removed.',
    '- Referenced `data.url` files use the canvas renderer because their row count is unknown. Keep them reasonably sized even within the 8 MB limit, and split very dense figures when needed.',
    '- Cost is driven by the number of views as well as the number of rows. Wide or nested `repeat` products over 400 views are rejected; prefer several figures over one enormous grid.',
    '- Specs that fail to compile render as a code block with the Vega-Lite error message shown. Use the `validate_vega_lite_spec` tool to check a spec before writing it into an article.',
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
    '- Cite provenance in the prose around the figure.',
    '- Plot the finest granularity the source data has. Do not downsample to fit a size limit — split into several figures or articles instead.',
    '- Reach for the view that answers the question: small multiples via `facet`/`repeat` for per-group comparison, `layer` to overlay a threshold `rule` on a series, interactive selections when a reader needs to isolate one series.',
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

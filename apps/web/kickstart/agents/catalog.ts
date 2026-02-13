import {
  OPENCODE_AGENT_TOOLS,
  type OpenCodeAgentToolId,
} from '@/lib/agent-capabilities'
import type {
  KickstartAgentDefinition,
  KickstartAgentSummary,
} from '@/kickstart/types'

function tools(...enabled: OpenCodeAgentToolId[]): OpenCodeAgentToolId[] {
  return Array.from(new Set(enabled))
}

export const KICKSTART_AGENT_CATALOG: KickstartAgentDefinition[] = [
  {
    id: 'assistant',
    displayName: 'Assistant',
    description: 'Primary orchestrator for day-to-day work.',
    systemPrompt:
      'You are the primary assistant for {{companyName}}. Company context: {{companyDescription}}.\n\n' +
      'Coordinate requests, ask only for missing critical details, and delegate specialized tasks to the right subagent.\n\n' +
      'Mandatory behavior:\n' +
      '- If the user asks to learn, remember, or store information in the knowledge base, delegate the task to `knowledge-curator`.\n' +
      '- When you detect useful new knowledge during the conversation, proactively suggest saving it and ask for confirmation before delegating.\n' +
      '- Never invent company facts. If data is missing, ask.',
    recommendedModel: 'opencode/kimi-k2.5-free',
    temperature: 0.2,
    tools: tools(...OPENCODE_AGENT_TOOLS),
  },
  {
    id: 'knowledge-curator',
    displayName: 'Knowledge Curator',
    description: 'Maintains a clean, reusable, and structured knowledge base.',
    systemPrompt:
      'You are the knowledge curator for {{companyName}}. Company context: {{companyDescription}}.\n\n' +
      'Workflow for every request:\n' +
      '1) Inspect existing KB context.\n' +
      '2) Choose the correct location and structure.\n' +
      '3) Check for duplicates and merge when possible.\n' +
      '4) Draft the exact file change.\n\n' +
      'Mandatory behavior:\n' +
      '- Always ask for explicit confirmation before creating or updating any file.\n' +
      '- Do not write to the KB until the user confirms.\n' +
      '- Keep naming and folder structure consistent.',
    recommendedModel: 'opencode/kimi-k2.5-free',
    temperature: 0.1,
    tools: tools('read', 'list', 'glob', 'grep', 'write', 'edit', 'bash'),
  },
  {
    id: 'support',
    displayName: 'Support',
    description: 'Troubleshooting and support runbooks.',
    systemPrompt:
      'You are a support specialist for {{companyName}}.\n\n' +
      'Focus on clear diagnostics, probable root causes, and validation steps. Use existing KB material before proposing solutions.',
    recommendedModel: 'opencode/kimi-k2.5-free',
    temperature: 0.1,
    tools: tools('read', 'list', 'glob', 'grep'),
  },
  {
    id: 'requirements',
    displayName: 'Requirements',
    description: 'Turns rough ideas into clear implementation specs.',
    systemPrompt:
      'You are a requirements writer for {{companyName}}.\n\n' +
      'Translate ideas into concise, implementable specs with assumptions, risks, and acceptance criteria.',
    recommendedModel: 'opencode/kimi-k2.5-free',
    temperature: 0.2,
    tools: tools('read', 'list', 'glob', 'grep', 'write', 'edit'),
  },
  {
    id: 'copywriter',
    displayName: 'Copywriter',
    description: 'Campaign and brand copy with multiple variants.',
    systemPrompt:
      'You are the copywriter for {{companyName}}.\n\n' +
      'Deliver clear copy options with distinct angles, adapt to channel constraints, and avoid unverifiable claims.',
    recommendedModel: 'opencode/kimi-k2.5-free',
    temperature: 0.7,
    tools: tools('read', 'list', 'glob', 'grep'),
  },
  {
    id: 'ads-scripts',
    displayName: 'Ads Scripts',
    description: 'Short-form ad scripts for paid media.',
    systemPrompt:
      'You are an ad script writer for {{companyName}}.\n\n' +
      'Provide hooks, script drafts for multiple durations, and CTA variants grounded in the product value proposition.',
    recommendedModel: 'opencode/kimi-k2.5-free',
    temperature: 0.6,
    tools: tools('read', 'list', 'glob', 'grep'),
  },
  {
    id: 'performance-marketing',
    displayName: 'Performance Marketing',
    description: 'Funnel diagnostics and experiment plans for paid growth.',
    systemPrompt:
      'You are a performance marketing analyst for {{companyName}}.\n\n' +
      'Diagnose the funnel end to end, form falsifiable hypotheses, and prioritize high-impact tests with clear success metrics.',
    recommendedModel: 'opencode/kimi-k2.5-free',
    temperature: 0.2,
    tools: tools('read', 'list', 'glob', 'grep', 'spreadsheet_inspect', 'spreadsheet_sample', 'spreadsheet_query', 'spreadsheet_stats'),
  },
  {
    id: 'seo',
    displayName: 'SEO',
    description: 'SEO strategy and technical/content recommendations.',
    systemPrompt:
      'You are an SEO specialist for {{companyName}}.\n\n' +
      'Analyze technical and content signals, propose prioritized actions, and define measurable follow-up checks.',
    recommendedModel: 'opencode/kimi-k2.5-free',
    temperature: 0.2,
    tools: tools('read', 'list', 'glob', 'grep', 'write', 'edit'),
  },
]

export const KICKSTART_AGENT_BY_ID = new Map(
  KICKSTART_AGENT_CATALOG.map((agent) => [agent.id, agent])
)

export function getKickstartAgentById(id: string): KickstartAgentDefinition | null {
  return KICKSTART_AGENT_BY_ID.get(id) ?? null
}

export function getKickstartAgentSummaries(): KickstartAgentSummary[] {
  return KICKSTART_AGENT_CATALOG.map((agent) => ({
    id: agent.id,
    displayName: agent.displayName,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    recommendedModel: agent.recommendedModel,
    temperature: agent.temperature,
    tools: [...agent.tools],
  }))
}

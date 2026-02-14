import type { OpenCodeAgentToolId } from '@/lib/agent-capabilities'

export type KickstartStatus = 'needs_setup' | 'ready' | 'setup_in_progress'

export type KickstartPlaceholderContext = {
  companyName: string
  companyDescription: string
}

export type KickstartAgentDefinition = {
  id: string
  displayName: string
  description: string
  systemPrompt: string
  recommendedModel: string
  temperature: number
  tools: OpenCodeAgentToolId[]
}

export type KickstartAgentSummary = KickstartAgentDefinition

export type KickstartKbSkeletonEntry =
  | {
      type: 'dir'
      path: string
    }
  | {
      type: 'file'
      path: string
      content: string
    }

export type KickstartTemplateDefinition = {
  id: string
  label: string
  description: string
  kbSkeleton: KickstartKbSkeletonEntry[]
  agentsMdTemplate: string
  recommendedAgentIds: string[]
  recommendedModels: Record<string, string>
}

export type KickstartTemplateSummary = {
  id: string
  label: string
  description: string
  recommendedAgentIds: string[]
  recommendedModels: Record<string, string>
}

export type KickstartTemplatesResponse = {
  templates: KickstartTemplateSummary[]
  agents: KickstartAgentSummary[]
}

export type KickstartAgentSelectionInput = {
  id: string
  model?: string
  prompt?: string
  temperature?: number
}

export type KickstartApplyRequestPayload = {
  companyName: string
  companyDescription: string
  templateId: string
  agents: KickstartAgentSelectionInput[]
}

export type KickstartNormalizedAgentSelection = {
  id: string
  modelOverride?: string
  promptOverride?: string
  temperatureOverride?: number
}

export type KickstartNormalizedApplyInput = {
  context: KickstartPlaceholderContext
  template: KickstartTemplateDefinition
  agents: KickstartNormalizedAgentSelection[]
}

export type KickstartRenderedFile = {
  path: string
  content: string
}

export type KickstartApplyArtifacts = {
  configContent: string
  agentsMdContent: string
  kbDirectories: string[]
  kbFiles: KickstartRenderedFile[]
}

export type KickstartApplyError =
  | 'invalid_payload'
  | 'already_configured'
  | 'conflict'
  | 'kb_unavailable'
  | 'apply_failed'

export type KickstartApplyResult =
  | { ok: true }
  | { ok: false; error: KickstartApplyError; message?: string }

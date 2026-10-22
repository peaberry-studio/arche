import { describe, expect, it } from 'vitest'

import { buildKickstartArtifacts } from '@/kickstart/build'
import type { KickstartNormalizedApplyInput } from '@/kickstart/types'
import { parseCommonWorkspaceConfig } from '@/lib/workspace-config'

const input: KickstartNormalizedApplyInput = {
  context: {
    companyName: 'Acme Labs',
    companyDescription: 'Analytics tools',
  },
  template: {
    id: 'blank',
    label: 'Blank',
    description: 'Minimal setup',
    kbSkeleton: [],
    agentsMdTemplate: '# AGENTS',
    recommendedAgentIds: ['assistant'],
    agentOverrides: {},
  },
  agents: [{ id: 'assistant' }],
}

describe('buildKickstartArtifacts', () => {
  it('includes markdown capability guidance in the generated AGENTS.md', () => {
    const result = buildKickstartArtifacts(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { agentsMdContent } = result.artifacts

    expect(agentsMdContent).toContain('## Markdown Capabilities')
    expect(agentsMdContent).toContain('vega-lite')
    expect(agentsMdContent).toMatch(/KaTeX|katex/)
    expect(agentsMdContent).toMatch(/publication/i)
    expect(agentsMdContent).toContain('Figure 1')
    expect(agentsMdContent).toContain('`arche_tools_chart_create`')
    expect(agentsMdContent).toContain('`arche_tools_learning_propose`')
    expect(agentsMdContent).not.toMatch(/`(?:chart_create|learning_propose)`/)
  })

  it('keeps stored capability ids compatible while naming runtime tools in prompts', () => {
    const result = buildKickstartArtifacts(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const parsed = parseCommonWorkspaceConfig(result.artifacts.configContent)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const assistant = parsed.config.agent?.assistant
    expect(assistant?.tools?.document_inspect).toBe(true)
    expect(assistant?.tools?.session_history_query).toBe(true)
    expect(assistant?.tools).not.toHaveProperty('arche_tools_document_inspect')
    expect(assistant?.prompt).toContain('`arche_tools_learning_propose`')
  })
})

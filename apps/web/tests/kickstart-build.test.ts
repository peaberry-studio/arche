import { describe, expect, it } from 'vitest'

import { buildKickstartArtifacts } from '@/kickstart/build'
import type { KickstartNormalizedApplyInput } from '@/kickstart/types'

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
  })
})

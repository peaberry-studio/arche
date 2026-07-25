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
    recommendedAgentIds: ['assistant', 'knowledge-curator'],
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

  it('tells agents the full Vega-Lite grammar is supported', () => {
    const result = buildKickstartArtifacts(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { agentsMdContent } = result.artifacts

    expect(agentsMdContent).toContain('The complete Vega-Lite grammar is supported')
    expect(agentsMdContent).toContain('https://vega.github.io/vega-lite/docs/')
    expect(agentsMdContent).toContain('validate_vega_lite_spec')

    // Features the old allowlist rejected must be advertised as available.
    for (const feature of ['geoshape', 'boxplot', 'facet', 'repeat', 'hconcat', 'params', 'projection']) {
      expect(agentsMdContent).toContain(feature)
    }

    // The old restrictions must not survive anywhere in the guide.
    expect(agentsMdContent).not.toContain('Allowed marks:')
    expect(agentsMdContent).not.toContain('Supported top-level keys:')
    expect(agentsMdContent).not.toMatch(/Maximum 1000 rows/)
    expect(agentsMdContent).not.toMatch(/No URLs, no `url`\/`href`\/`src` keys/)
  })
})

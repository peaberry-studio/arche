import { describe, expect, it } from 'vitest'

import { KICKSTART_AGENT_BY_ID } from '@/kickstart/agents/catalog'
import { buildKickstartArtifacts } from '@/kickstart/build'
import { renderKickstartText } from '@/kickstart/render'
import { getKickstartTemplateById } from '@/kickstart/templates'
import { parseKickstartApplyPayload } from '@/kickstart/validation'

describe('kickstart manifests', () => {
  it('blank template contains required minimal KB structure', () => {
    const blank = getKickstartTemplateById('blank')
    expect(blank).not.toBeNull()

    const skeletonPaths = new Set(blank?.kbSkeleton.map((entry) => entry.path))
    expect(skeletonPaths.has('Outputs')).toBe(true)
    expect(skeletonPaths.has('Company/00 - Company Profile.md')).toBe(true)
    expect(skeletonPaths.has('Company/01 - Glossary.md')).toBe(true)

    expect(blank?.recommendedAgentIds).toEqual(['assistant', 'knowledge-curator'])
  })

  it('assistant and knowledge-curator prompts enforce memory delegation flow', () => {
    const assistant = KICKSTART_AGENT_BY_ID.get('assistant')
    const curator = KICKSTART_AGENT_BY_ID.get('knowledge-curator')

    expect(assistant?.systemPrompt.toLowerCase()).toContain('learn')
    expect(assistant?.systemPrompt.toLowerCase()).toContain('remember')
    expect(assistant?.systemPrompt.toLowerCase()).toContain('knowledge-curator')

    expect(curator?.systemPrompt.toLowerCase()).toContain('confirmation')
    expect(curator?.systemPrompt.toLowerCase()).toContain('before creating or updating')
  })
})

describe('kickstart artifact generation', () => {
  it('renders placeholders and builds valid config from selection', () => {
    const parsed = parseKickstartApplyPayload({
      companyName: 'Acme Labs',
      companyDescription: 'Analytics tools for operations teams',
      templateId: 'blank',
      agents: [
        { id: 'assistant' },
        { id: 'knowledge-curator' },
      ],
    })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }

    const built = buildKickstartArtifacts(parsed.input)
    expect(built.ok).toBe(true)
    if (!built.ok) {
      return
    }

    const config = JSON.parse(built.artifacts.configContent) as {
      default_agent: string
      agent: Record<string, { mode: string; prompt: string }>
    }

    expect(config.default_agent).toBe('assistant')
    expect(Object.keys(config.agent).sort()).toEqual([
      'assistant',
      'knowledge-curator',
    ])

    const profileFile = built.artifacts.kbFiles.find(
      (file) => file.path === 'Company/00 - Company Profile.md'
    )
    expect(profileFile?.content).toContain('Acme Labs')
    expect(profileFile?.content).toContain('Analytics tools for operations teams')
  })

  it('keeps unknown placeholders untouched', () => {
    const output = renderKickstartText(
      'Known {{ companyName }} unknown {{ malicious }}',
      {
        companyName: 'Acme Labs',
        companyDescription: 'Analytics tools',
      }
    )

    expect(output).toContain('Known Acme Labs')
    expect(output).toContain('{{ malicious }}')
  })
})

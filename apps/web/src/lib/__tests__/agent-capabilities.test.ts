import { describe, expect, it } from 'vitest'

import {
  buildAgentPermissionConfigFromCapabilities,
  buildAgentToolsConfigFromCapabilities,
  extractAgentCapabilitiesFromTools,
  validateAgentCapabilityConnectorIds,
  validateAgentCapabilitySkillIds,
  validateAgentCapabilityTools,
} from '@/lib/agent-capabilities'

describe('agent-capabilities', () => {
  it('rejects unknown tools', () => {
    const result = validateAgentCapabilityTools(['read', 'unknown-tool'])
    expect(result.ok).toBe(false)
  })

  it('accepts known tools and deduplicates values', () => {
    const result = validateAgentCapabilityTools([
      'presentation_inspect',
      'grep',
      'spreadsheet_query',
      'document_inspect',
      'read',
      'read',
    ])
    expect(result).toEqual({
      ok: true,
      tools: ['document_inspect', 'grep', 'presentation_inspect', 'read', 'spreadsheet_query'],
    })
  })

  it('rejects invalid mcp connector ids', () => {
    const result = validateAgentCapabilityConnectorIds(['connector-1', 123])
    expect(result.ok).toBe(false)
  })

  it('builds tools config from capabilities', () => {
    const config = buildAgentToolsConfigFromCapabilities(
      {
        skillIds: ['pdf-processing'],
        tools: ['document_inspect', 'presentation_inspect', 'read', 'grep'],
        mcpConnectorIds: ['cntr1', 'cntr3'],
      },
      [
        { id: 'cntr1', type: 'linear', enabled: true },
        { id: 'cntr2', type: 'notion', enabled: true },
        { id: 'cntr3', type: 'zendesk', enabled: true },
      ]
    )

    expect(config.read).toBe(true)
    expect(config.grep).toBe(true)
    expect(config.document_inspect).toBe(true)
    expect(config.presentation_inspect).toBe(true)
    expect(config.skill).toBe(true)
    expect(config.write).toBe(false)
    expect(config['arche_*']).toBe(false)
    expect(config['arche_linear_cntr1_*']).toBe(true)
    expect(config['arche_zendesk_cntr3_*']).toBe(true)
    expect(config['arche_notion_cntr2_*']).toBeUndefined()
  })

  it('extracts capabilities from tools config', () => {
    const capabilities = extractAgentCapabilitiesFromTools(
      {
        read: true,
        grep: true,
        document_inspect: true,
        skill: true,
        write: false,
        'arche_*': false,
        'arche_custom_conn123_*': true,
        'arche_zendesk_conn456_*': true,
      },
      {
        skill: {
          '*': 'deny',
          'pdf-processing': 'allow',
        },
      }
    )

    expect(capabilities).toEqual({
      skillIds: ['pdf-processing'],
      tools: ['document_inspect', 'grep', 'read'],
      mcpConnectorIds: ['conn123', 'conn456'],
    })
  })

  it('validates skill ids', () => {
    expect(validateAgentCapabilitySkillIds(['pdf-processing', 'release-notes'])).toEqual({
      ok: true,
      skillIds: ['pdf-processing', 'release-notes'],
    })

    expect(validateAgentCapabilitySkillIds(['BadName'])).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
  })

  it('builds skill permission config while preserving other permissions', () => {
    expect(
      buildAgentPermissionConfigFromCapabilities(
        {
          skillIds: ['pdf-processing'],
          tools: ['read'],
          mcpConnectorIds: [],
        },
        {
          bash: {
            '*': 'allow',
          },
        }
      )
    ).toEqual({
      bash: {
        '*': 'allow',
      },
      skill: {
        '*': 'deny',
        'pdf-processing': 'allow',
      },
    })
  })
})

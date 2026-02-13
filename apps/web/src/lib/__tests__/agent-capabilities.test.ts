import { describe, expect, it } from 'vitest'

import {
  buildAgentToolsConfigFromCapabilities,
  extractAgentCapabilitiesFromTools,
  validateAgentCapabilityConnectorIds,
  validateAgentCapabilityTools,
} from '@/lib/agent-capabilities'

describe('agent-capabilities', () => {
  it('rejects unknown tools', () => {
    const result = validateAgentCapabilityTools(['read', 'unknown-tool'])
    expect(result.ok).toBe(false)
  })

  it('accepts known tools and deduplicates values', () => {
    const result = validateAgentCapabilityTools([
      'grep',
      'spreadsheet_query',
      'read',
      'read',
    ])
    expect(result).toEqual({
      ok: true,
      tools: ['grep', 'read', 'spreadsheet_query'],
    })
  })

  it('rejects invalid mcp connector ids', () => {
    const result = validateAgentCapabilityConnectorIds(['connector-1', 123])
    expect(result.ok).toBe(false)
  })

  it('builds tools config from capabilities', () => {
    const config = buildAgentToolsConfigFromCapabilities(
      {
        tools: ['read', 'grep'],
        mcpConnectorIds: ['cntr1'],
      },
      [
        { id: 'cntr1', type: 'linear', enabled: true },
        { id: 'cntr2', type: 'notion', enabled: true },
      ]
    )

    expect(config.read).toBe(true)
    expect(config.grep).toBe(true)
    expect(config.write).toBe(false)
    expect(config['arche_*']).toBe(false)
    expect(config['arche_linear_cntr1_*']).toBe(true)
    expect(config['arche_notion_cntr2_*']).toBeUndefined()
  })

  it('extracts capabilities from tools config', () => {
    const capabilities = extractAgentCapabilitiesFromTools({
      read: true,
      grep: true,
      write: false,
      'arche_*': false,
      'arche_custom_conn123_*': true,
    })

    expect(capabilities).toEqual({
      tools: ['grep', 'read'],
      mcpConnectorIds: ['conn123'],
    })
  })
})

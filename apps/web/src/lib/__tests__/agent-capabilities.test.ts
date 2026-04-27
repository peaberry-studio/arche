import { describe, expect, it } from 'vitest'

import {
  buildAgentPermissionConfigFromCapabilities,
  buildAgentToolsConfigFromCapabilities,
  extractAgentCapabilitiesFromTools,
  getConnectorCapabilityId,
  OPENCODE_AGENT_TOOLS,
  validateAgentCapabilityConnectorIds,
  validateAgentCapabilitySkillIds,
  validateAgentCapabilityTools,
} from '@/lib/agent-capabilities'

// ---------------------------------------------------------------------------
// validateAgentCapabilityTools
// ---------------------------------------------------------------------------
describe('validateAgentCapabilityTools', () => {
  it('accepts an empty array', () => {
    expect(validateAgentCapabilityTools([])).toEqual({ ok: true, tools: [] })
  })

  it('accepts a single known tool', () => {
    const result = validateAgentCapabilityTools(['read'])
    expect(result).toEqual({ ok: true, tools: ['read'] })
  })

  it('accepts all known tools', () => {
    const result = validateAgentCapabilityTools([...OPENCODE_AGENT_TOOLS])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tools).toHaveLength(OPENCODE_AGENT_TOOLS.length)
    }
  })

  it('deduplicates and sorts the result', () => {
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

  it('rejects non-array values', () => {
    expect(validateAgentCapabilityTools(null)).toEqual({ ok: false, error: 'invalid_tools' })
    expect(validateAgentCapabilityTools(undefined)).toEqual({ ok: false, error: 'invalid_tools' })
    expect(validateAgentCapabilityTools('read')).toEqual({ ok: false, error: 'invalid_tools' })
    expect(validateAgentCapabilityTools(42)).toEqual({ ok: false, error: 'invalid_tools' })
    expect(validateAgentCapabilityTools({})).toEqual({ ok: false, error: 'invalid_tools' })
  })

  it('rejects arrays containing unknown tool names', () => {
    const result = validateAgentCapabilityTools(['read', 'unknown-tool'])
    expect(result).toEqual({ ok: false, error: 'invalid_tools' })
  })

  it('rejects arrays containing non-string elements', () => {
    expect(validateAgentCapabilityTools(['read', 123])).toEqual({
      ok: false,
      error: 'invalid_tools',
    })
    expect(validateAgentCapabilityTools([null])).toEqual({ ok: false, error: 'invalid_tools' })
    expect(validateAgentCapabilityTools([true])).toEqual({ ok: false, error: 'invalid_tools' })
  })
})

// ---------------------------------------------------------------------------
// validateAgentCapabilityConnectorIds
// ---------------------------------------------------------------------------
describe('validateAgentCapabilityConnectorIds', () => {
  it('accepts an empty array', () => {
    expect(validateAgentCapabilityConnectorIds([])).toEqual({ ok: true, connectorIds: [] })
  })

  it('accepts valid string connector ids', () => {
    const result = validateAgentCapabilityConnectorIds(['conn-1', 'conn-2'])
    expect(result).toEqual({ ok: true, connectorIds: ['conn-1', 'conn-2'] })
  })

  it('deduplicates and sorts the result', () => {
    const result = validateAgentCapabilityConnectorIds(['zzz', 'aaa', 'mmm', 'aaa'])
    expect(result).toEqual({ ok: true, connectorIds: ['aaa', 'mmm', 'zzz'] })
  })

  it('trims whitespace from connector ids', () => {
    const result = validateAgentCapabilityConnectorIds(['  conn-1  ', ' conn-2 '])
    expect(result).toEqual({ ok: true, connectorIds: ['conn-1', 'conn-2'] })
  })

  it('rejects non-array values', () => {
    expect(validateAgentCapabilityConnectorIds(null)).toEqual({
      ok: false,
      error: 'invalid_mcp_connector_ids',
    })
    expect(validateAgentCapabilityConnectorIds('conn-1')).toEqual({
      ok: false,
      error: 'invalid_mcp_connector_ids',
    })
    expect(validateAgentCapabilityConnectorIds(42)).toEqual({
      ok: false,
      error: 'invalid_mcp_connector_ids',
    })
    expect(validateAgentCapabilityConnectorIds(undefined)).toEqual({
      ok: false,
      error: 'invalid_mcp_connector_ids',
    })
  })

  it('rejects arrays containing non-string elements', () => {
    expect(validateAgentCapabilityConnectorIds(['conn-1', 123])).toEqual({
      ok: false,
      error: 'invalid_mcp_connector_ids',
    })
    expect(validateAgentCapabilityConnectorIds([null])).toEqual({
      ok: false,
      error: 'invalid_mcp_connector_ids',
    })
  })

  it('rejects arrays containing empty strings', () => {
    expect(validateAgentCapabilityConnectorIds(['conn-1', ''])).toEqual({
      ok: false,
      error: 'invalid_mcp_connector_ids',
    })
  })

  it('rejects arrays containing whitespace-only strings', () => {
    expect(validateAgentCapabilityConnectorIds(['   '])).toEqual({
      ok: false,
      error: 'invalid_mcp_connector_ids',
    })
  })
})

// ---------------------------------------------------------------------------
// validateAgentCapabilitySkillIds
// ---------------------------------------------------------------------------
describe('validateAgentCapabilitySkillIds', () => {
  it('accepts an empty array', () => {
    expect(validateAgentCapabilitySkillIds([])).toEqual({ ok: true, skillIds: [] })
  })

  it('accepts valid skill ids matching the pattern', () => {
    expect(validateAgentCapabilitySkillIds(['pdf-processing', 'release-notes'])).toEqual({
      ok: true,
      skillIds: ['pdf-processing', 'release-notes'],
    })
  })

  it('accepts single-segment names', () => {
    expect(validateAgentCapabilitySkillIds(['summarize'])).toEqual({
      ok: true,
      skillIds: ['summarize'],
    })
  })

  it('deduplicates and sorts the result', () => {
    const result = validateAgentCapabilitySkillIds(['zzz', 'aaa', 'mmm', 'aaa'])
    expect(result).toEqual({ ok: true, skillIds: ['aaa', 'mmm', 'zzz'] })
  })

  it('trims whitespace from skill ids', () => {
    const result = validateAgentCapabilitySkillIds(['  my-skill  '])
    expect(result).toEqual({ ok: true, skillIds: ['my-skill'] })
  })

  it('rejects non-array values', () => {
    expect(validateAgentCapabilitySkillIds(null)).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
    expect(validateAgentCapabilitySkillIds('my-skill')).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
    expect(validateAgentCapabilitySkillIds(42)).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
  })

  it('rejects arrays containing non-string elements', () => {
    expect(validateAgentCapabilitySkillIds([123])).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
    expect(validateAgentCapabilitySkillIds([null])).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
  })

  it('rejects empty strings', () => {
    expect(validateAgentCapabilitySkillIds([''])).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
  })

  it('rejects skill ids exceeding 64 characters', () => {
    const longId = 'a'.repeat(65)
    expect(validateAgentCapabilitySkillIds([longId])).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
  })

  it('accepts skill ids exactly 64 characters long', () => {
    const maxId = 'a'.repeat(64)
    const result = validateAgentCapabilitySkillIds([maxId])
    expect(result.ok).toBe(true)
  })

  it('rejects names that do not match SKILL_NAME_PATTERN', () => {
    expect(validateAgentCapabilitySkillIds(['BadName'])).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
    expect(validateAgentCapabilitySkillIds(['my_skill'])).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
    expect(validateAgentCapabilitySkillIds(['my skill'])).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
    expect(validateAgentCapabilitySkillIds(['-leading-dash'])).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
    expect(validateAgentCapabilitySkillIds(['trailing-dash-'])).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
    expect(validateAgentCapabilitySkillIds(['double--dash'])).toEqual({
      ok: false,
      error: 'invalid_skill_ids',
    })
  })
})

// ---------------------------------------------------------------------------
// buildAgentToolsConfigFromCapabilities
// ---------------------------------------------------------------------------
describe('buildAgentToolsConfigFromCapabilities', () => {
  it('enables only the specified tools and disables the rest', () => {
    const config = buildAgentToolsConfigFromCapabilities(
      { skillIds: [], tools: ['read', 'grep'], mcpConnectorIds: [] },
      []
    )

    expect(config.read).toBe(true)
    expect(config.grep).toBe(true)
    expect(config.write).toBe(false)
    expect(config.bash).toBe(false)
    expect(config.edit).toBe(false)
  })

  it('includes an entry for every known tool', () => {
    const config = buildAgentToolsConfigFromCapabilities(
      { skillIds: [], tools: [], mcpConnectorIds: [] },
      []
    )

    for (const toolId of OPENCODE_AGENT_TOOLS) {
      expect(config).toHaveProperty(toolId)
      expect(config[toolId]).toBe(false)
    }
  })

  it('sets skill to true when skillIds are present', () => {
    const config = buildAgentToolsConfigFromCapabilities(
      { skillIds: ['pdf-processing'], tools: [], mcpConnectorIds: [] },
      []
    )
    expect(config.skill).toBe(true)
  })

  it('sets skill to false when skillIds are empty', () => {
    const config = buildAgentToolsConfigFromCapabilities(
      { skillIds: [], tools: [], mcpConnectorIds: [] },
      []
    )
    expect(config.skill).toBe(false)
  })

  it('always sets arche_* to false', () => {
    const config = buildAgentToolsConfigFromCapabilities(
      { skillIds: [], tools: ['read'], mcpConnectorIds: ['globallinear'] },
      [{ id: 'globallinear', type: 'linear' }]
    )
    expect(config['arche_*']).toBe(false)
  })

  it('creates arche_TYPE_ID_* entries for enabled MCP connectors', () => {
    const config = buildAgentToolsConfigFromCapabilities(
      {
        skillIds: [],
        tools: [],
        mcpConnectorIds: ['globallinear', 'globalumami', 'globalzendesk'],
      },
      [
        { id: 'globallinear', type: 'linear' },
        { id: 'globalmetaads', type: 'meta-ads' },
        { id: 'globalnotion', type: 'notion' },
        { id: 'globalumami', type: 'umami' },
        { id: 'globalzendesk', type: 'zendesk' },
      ]
    )

    expect(config['arche_linear_globallinear_*']).toBe(true)
    expect(config['arche_meta-ads_globalmetaads_*']).toBeUndefined()
    expect(config['arche_umami_globalumami_*']).toBe(true)
    expect(config['arche_zendesk_globalzendesk_*']).toBe(true)
  })

  it('creates arche_custom_ID_* entries for custom connectors', () => {
    const config = buildAgentToolsConfigFromCapabilities(
      { skillIds: [], tools: [], mcpConnectorIds: ['my-custom-conn'] },
      [{ id: 'my-custom-conn', type: 'custom' }]
    )

    expect(config['arche_custom_my-custom-conn_*']).toBe(true)
  })

  it('skips connector ids not found in the connectors list', () => {
    const config = buildAgentToolsConfigFromCapabilities(
      { skillIds: [], tools: [], mcpConnectorIds: ['nonexistent'] },
      [{ id: 'other', type: 'linear' }]
    )

    // No arche_ entry for nonexistent connector
    const mcpKeys = Object.keys(config).filter(
      (k) => k.startsWith('arche_') && k !== 'arche_*'
    )
    expect(mcpKeys).toHaveLength(0)
  })

  it('does not include arche entry for connectors not in mcpConnectorIds', () => {
    const config = buildAgentToolsConfigFromCapabilities(
      { skillIds: [], tools: [], mcpConnectorIds: ['globallinear'] },
      [
        { id: 'globallinear', type: 'linear' },
        { id: 'globalnotion', type: 'notion' },
      ]
    )

    expect(config['arche_linear_globallinear_*']).toBe(true)
    expect(config['arche_notion_globalnotion_*']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// extractAgentCapabilitiesFromTools
// ---------------------------------------------------------------------------
describe('extractAgentCapabilitiesFromTools', () => {
  it('returns empty capabilities when tools is undefined', () => {
    expect(extractAgentCapabilitiesFromTools(undefined)).toEqual({
      skillIds: [],
      tools: [],
      mcpConnectorIds: [],
    })
  })

  it('returns empty capabilities when all tools are false', () => {
    const result = extractAgentCapabilitiesFromTools({
      read: false,
      write: false,
      'arche_*': false,
    })
    expect(result).toEqual({
      skillIds: [],
      tools: [],
      mcpConnectorIds: [],
    })
  })

  it('extracts enabled agent tools', () => {
    const result = extractAgentCapabilitiesFromTools({
      read: true,
      grep: true,
      write: false,
      bash: false,
    })
    expect(result.tools).toEqual(['grep', 'read'])
  })

  it('sorts the extracted tools', () => {
    const result = extractAgentCapabilitiesFromTools({
      write: true,
      bash: true,
      read: true,
    })
    expect(result.tools).toEqual(['bash', 'read', 'write'])
  })

  it('extracts MCP connector ids from arche_ patterns', () => {
    const result = extractAgentCapabilitiesFromTools({
      'arche_*': false,
      'arche_custom_conn123_*': true,
      'arche_linear_globallinear_*': true,
    })
    // custom type: returns the id directly (conn123)
    // linear type: returns the global id via getConnectorCapabilityId
    expect(result.mcpConnectorIds).toEqual(['conn123', 'globallinear'])
  })

  it('ignores disabled MCP connector tools', () => {
    const result = extractAgentCapabilitiesFromTools({
      'arche_*': false,
      'arche_custom_conn123_*': false,
    })
    expect(result.mcpConnectorIds).toEqual([])
  })

  it('maps single-instance connector types to global ids', () => {
    const result = extractAgentCapabilitiesFromTools({
      'arche_umami_conn999_*': true,
      'arche_zendesk_conn456_*': true,
    })
    expect(result.mcpConnectorIds).toEqual(['globalumami', 'globalzendesk'])
  })

  it('extracts skill ids from permission when skill tool is enabled', () => {
    const result = extractAgentCapabilitiesFromTools(
      { skill: true },
      {
        skill: {
          '*': 'deny',
          'pdf-processing': 'allow',
          'release-notes': 'allow',
        },
      }
    )
    expect(result.skillIds).toEqual(['pdf-processing', 'release-notes'])
  })

  it('ignores denied skills', () => {
    const result = extractAgentCapabilitiesFromTools(
      { skill: true },
      {
        skill: {
          '*': 'deny',
          'pdf-processing': 'allow',
          'blocked-skill': 'deny',
          'ask-skill': 'ask',
        },
      }
    )
    expect(result.skillIds).toEqual(['pdf-processing'])
  })

  it('ignores the wildcard entry in skill permissions', () => {
    const result = extractAgentCapabilitiesFromTools(
      { skill: true },
      {
        skill: {
          '*': 'allow',
          'my-skill': 'allow',
        },
      }
    )
    // '*' is always excluded
    expect(result.skillIds).toEqual(['my-skill'])
  })

  it('returns empty skillIds when skill tool is false', () => {
    const result = extractAgentCapabilitiesFromTools(
      { skill: false },
      {
        skill: {
          '*': 'deny',
          'pdf-processing': 'allow',
        },
      }
    )
    expect(result.skillIds).toEqual([])
  })

  it('returns empty skillIds when permission is undefined', () => {
    const result = extractAgentCapabilitiesFromTools({ skill: true })
    expect(result.skillIds).toEqual([])
  })

  it('returns empty skillIds when permission.skill is not a record', () => {
    const result = extractAgentCapabilitiesFromTools({ skill: true }, { skill: 'allow' })
    expect(result.skillIds).toEqual([])
  })

  it('combines tools, connectors, and skills in a full extraction', () => {
    const capabilities = extractAgentCapabilitiesFromTools(
      {
        read: true,
        grep: true,
        document_inspect: true,
        skill: true,
        write: false,
        'arche_*': false,
        'arche_custom_conn123_*': true,
        'arche_umami_conn999_*': true,
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
      mcpConnectorIds: ['conn123', 'globalumami', 'globalzendesk'],
    })
  })
})

// ---------------------------------------------------------------------------
// buildAgentPermissionConfigFromCapabilities
// ---------------------------------------------------------------------------
describe('buildAgentPermissionConfigFromCapabilities', () => {
  it('builds skill permission map with deny-all default and individual allows', () => {
    const result = buildAgentPermissionConfigFromCapabilities(
      { skillIds: ['pdf-processing', 'release-notes'], tools: [], mcpConnectorIds: [] },
      undefined
    )
    expect(result).toEqual({
      skill: {
        '*': 'deny',
        'pdf-processing': 'allow',
        'release-notes': 'allow',
      },
    })
  })

  it('preserves existing permission keys when adding skills', () => {
    const result = buildAgentPermissionConfigFromCapabilities(
      { skillIds: ['pdf-processing'], tools: ['read'], mcpConnectorIds: [] },
      { bash: { '*': 'allow' } }
    )
    expect(result).toEqual({
      bash: { '*': 'allow' },
      skill: {
        '*': 'deny',
        'pdf-processing': 'allow',
      },
    })
  })

  it('removes skill key when skillIds is empty', () => {
    const result = buildAgentPermissionConfigFromCapabilities(
      { skillIds: [], tools: ['read'], mcpConnectorIds: [] },
      {
        bash: { '*': 'allow' },
        skill: { '*': 'deny', 'old-skill': 'allow' },
      }
    )
    expect(result).toEqual({
      bash: { '*': 'allow' },
    })
    expect(result).not.toHaveProperty('skill')
  })

  it('returns undefined when no skills and no existing permission keys', () => {
    const result = buildAgentPermissionConfigFromCapabilities(
      { skillIds: [], tools: [], mcpConnectorIds: [] },
      undefined
    )
    expect(result).toBeUndefined()
  })

  it('returns undefined when no skills and existing only had skill key', () => {
    const result = buildAgentPermissionConfigFromCapabilities(
      { skillIds: [], tools: [], mcpConnectorIds: [] },
      { skill: { '*': 'deny', 'old-skill': 'allow' } }
    )
    expect(result).toBeUndefined()
  })

  it('handles non-record existingPermission by starting fresh', () => {
    const result = buildAgentPermissionConfigFromCapabilities(
      { skillIds: ['my-skill'], tools: [], mcpConnectorIds: [] },
      'not-a-record'
    )
    expect(result).toEqual({
      skill: {
        '*': 'deny',
        'my-skill': 'allow',
      },
    })
  })

  it('handles null existingPermission', () => {
    const result = buildAgentPermissionConfigFromCapabilities(
      { skillIds: ['my-skill'], tools: [], mcpConnectorIds: [] },
      null
    )
    expect(result).toEqual({
      skill: {
        '*': 'deny',
        'my-skill': 'allow',
      },
    })
  })

  it('replaces existing skill config entirely with new skill ids', () => {
    const result = buildAgentPermissionConfigFromCapabilities(
      { skillIds: ['new-skill'], tools: [], mcpConnectorIds: [] },
      { skill: { '*': 'deny', 'old-skill': 'allow' } }
    )
    expect(result).toEqual({
      skill: {
        '*': 'deny',
        'new-skill': 'allow',
      },
    })
    expect(result?.skill).not.toHaveProperty('old-skill')
  })
})

// ---------------------------------------------------------------------------
// getConnectorCapabilityId
// ---------------------------------------------------------------------------
describe('getConnectorCapabilityId', () => {
  it('returns the connector id for custom type', () => {
    expect(getConnectorCapabilityId('custom', 'my-conn-123')).toBe('my-conn-123')
  })

  it('returns global id for linear type', () => {
    expect(getConnectorCapabilityId('linear', 'any-id')).toBe('globallinear')
  })

  it('returns global id for notion type', () => {
    expect(getConnectorCapabilityId('notion', 'any-id')).toBe('globalnotion')
  })

  it('returns global id for zendesk type', () => {
    expect(getConnectorCapabilityId('zendesk', 'any-id')).toBe('globalzendesk')
  })

  it('returns global id for ahrefs type', () => {
    expect(getConnectorCapabilityId('ahrefs', 'any-id')).toBe('globalahrefs')
  })

  it('returns global id for umami type', () => {
    expect(getConnectorCapabilityId('umami', 'any-id')).toBe('globalumami')
  })
})

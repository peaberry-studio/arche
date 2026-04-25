import { describe, expect, it } from 'vitest'

import {
  createDefaultCommonWorkspaceConfig,
  ensurePrimaryAgent,
  generateAgentId,
  getAgentSummaries,
  getAssignedAgentIdsForSkill,
  parseCommonWorkspaceConfig,
  setAgentSkillIds,
  setSkillAssignments,
  validateCommonWorkspaceConfig,
  type CommonWorkspaceConfig,
} from '../workspace-config'

describe('parseCommonWorkspaceConfig', () => {
  it('parses valid JSON', () => {
    const result = parseCommonWorkspaceConfig('{"agent":{},"default_agent":"a"}')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.default_agent).toBe('a')
  })

  it('rejects empty string', () => {
    expect(parseCommonWorkspaceConfig('')).toEqual({ ok: false, error: 'empty_config' })
  })

  it('rejects whitespace-only string', () => {
    expect(parseCommonWorkspaceConfig('   ')).toEqual({ ok: false, error: 'empty_config' })
  })

  it('rejects invalid JSON', () => {
    expect(parseCommonWorkspaceConfig('{bad')).toEqual({ ok: false, error: 'invalid_json' })
  })

  it('rejects arrays', () => {
    expect(parseCommonWorkspaceConfig('[1,2]')).toEqual({ ok: false, error: 'invalid_config' })
  })

  it('rejects null', () => {
    expect(parseCommonWorkspaceConfig('null')).toEqual({ ok: false, error: 'invalid_config' })
  })
})

describe('validateCommonWorkspaceConfig', () => {
  const base = createDefaultCommonWorkspaceConfig()

  it('accepts a valid config', () => {
    expect(validateCommonWorkspaceConfig(base)).toEqual({ ok: true })
  })

  it('rejects missing agents', () => {
    expect(validateCommonWorkspaceConfig({ default_agent: 'x' })).toEqual({ ok: false, error: 'missing_agents' })
  })

  it('rejects empty agents', () => {
    expect(validateCommonWorkspaceConfig({ default_agent: 'x', agent: {} })).toEqual({ ok: false, error: 'no_agents' })
  })

  it('rejects missing default_agent', () => {
    expect(validateCommonWorkspaceConfig({ agent: { a: {} } })).toEqual({ ok: false, error: 'missing_default_agent' })
  })

  it('rejects default_agent not in agents', () => {
    expect(validateCommonWorkspaceConfig({ default_agent: 'missing', agent: { a: {} } })).toEqual({
      ok: false,
      error: 'default_agent_not_found',
    })
  })

  it('rejects multiple primary agents', () => {
    const config: CommonWorkspaceConfig = {
      default_agent: 'a',
      agent: {
        a: { mode: 'primary' },
        b: { mode: 'primary' },
      },
    }
    expect(validateCommonWorkspaceConfig(config)).toEqual({ ok: false, error: 'multiple_primary_agents' })
  })

  it('rejects primary agent that is not the default', () => {
    const config: CommonWorkspaceConfig = {
      default_agent: 'a',
      agent: {
        a: { mode: 'subagent' },
        b: { mode: 'primary' },
      },
    }
    expect(validateCommonWorkspaceConfig(config)).toEqual({ ok: false, error: 'default_agent_mismatch' })
  })

  it('accepts non-object input gracefully', () => {
    expect(validateCommonWorkspaceConfig(null as unknown as CommonWorkspaceConfig)).toEqual({
      ok: false,
      error: 'invalid_config',
    })
  })

  it('rejects agent as an array', () => {
    expect(validateCommonWorkspaceConfig({ default_agent: 'a', agent: [1] as unknown as Record<string, unknown> })).toEqual({
      ok: false,
      error: 'missing_agents',
    })
  })
})

describe('createDefaultCommonWorkspaceConfig', () => {
  it('returns a valid config', () => {
    const config = createDefaultCommonWorkspaceConfig()
    expect(validateCommonWorkspaceConfig(config)).toEqual({ ok: true })
    expect(config.default_agent).toBe('assistant')
    expect(config.agent?.assistant?.mode).toBe('primary')
  })
})

describe('getAgentSummaries', () => {
  it('returns summaries with capabilities', () => {
    const config = createDefaultCommonWorkspaceConfig()
    const summaries = getAgentSummaries(config)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].id).toBe('assistant')
    expect(summaries[0].displayName).toBe('Assistant')
    expect(summaries[0].isPrimary).toBe(true)
    expect(summaries[0].capabilities.tools).toContain('write')
  })

  it('uses id as display name when display_name is missing', () => {
    const config: CommonWorkspaceConfig = {
      default_agent: 'bot',
      agent: { bot: {} },
    }
    const summaries = getAgentSummaries(config)
    expect(summaries[0].displayName).toBe('bot')
  })

  it('marks non-default agents as not primary', () => {
    const config: CommonWorkspaceConfig = {
      default_agent: 'a',
      agent: {
        a: { mode: 'primary', display_name: 'A' },
        b: { mode: 'subagent', display_name: 'B' },
      },
    }
    const summaries = getAgentSummaries(config)
    const agentB = summaries.find((s) => s.id === 'b')
    expect(agentB?.isPrimary).toBe(false)
  })

  it('extracts skill ids from permission', () => {
    const config: CommonWorkspaceConfig = {
      default_agent: 'a',
      agent: {
        a: {
          tools: { skill: true, write: true },
          permission: { skill: { '*': 'deny', 'my-skill': 'allow' } },
        },
      },
    }
    const summaries = getAgentSummaries(config)
    expect(summaries[0].capabilities.skillIds).toEqual(['my-skill'])
  })

  it('handles empty config gracefully', () => {
    const summaries = getAgentSummaries({})
    expect(summaries).toEqual([])
  })
})

describe('ensurePrimaryAgent', () => {
  it('sets the specified agent as primary and demotes others', () => {
    const config: CommonWorkspaceConfig = {
      default_agent: 'a',
      agent: {
        a: { mode: 'primary', display_name: 'A' },
        b: { mode: 'subagent', display_name: 'B' },
      },
    }
    const result = ensurePrimaryAgent(config, 'b')
    expect(result.default_agent).toBe('b')
    expect(result.agent?.a?.mode).toBe('subagent')
    expect(result.agent?.b?.mode).toBe('primary')
  })

  it('preserves agents that are not primary', () => {
    const config: CommonWorkspaceConfig = {
      default_agent: 'a',
      agent: {
        a: { mode: 'primary' },
        b: { mode: 'subagent' },
        c: { mode: 'all' },
      },
    }
    const result = ensurePrimaryAgent(config, 'b')
    expect(result.agent?.c?.mode).toBe('all')
  })
})

describe('generateAgentId', () => {
  it('generates from display name', () => {
    expect(generateAgentId('My Agent', [])).toBe('my-agent')
  })

  it('handles unicode characters', () => {
    expect(generateAgentId('Café Bot', [])).toBe('cafe-bot')
  })

  it('deduplicates against existing ids', () => {
    expect(generateAgentId('agent', ['agent'])).toBe('agent-2')
    expect(generateAgentId('agent', ['agent', 'agent-2'])).toBe('agent-3')
  })

  it('falls back to "agent" for empty name', () => {
    expect(generateAgentId('', [])).toBe('agent')
  })

  it('falls back to "agent" for special-chars-only name', () => {
    expect(generateAgentId('!!!', [])).toBe('agent')
  })

  it('strips leading and trailing hyphens', () => {
    expect(generateAgentId('--hello--', [])).toBe('hello')
  })
})

describe('setAgentSkillIds', () => {
  it('enables skill tool when skill ids provided', () => {
    const agent = { tools: { write: true } }
    const result = setAgentSkillIds(agent, ['summarize'])
    expect(result.tools?.skill).toBe(true)
    expect(result.permission).toEqual({
      skill: { '*': 'deny', summarize: 'allow' },
    })
  })

  it('removes skill tool when no skill ids', () => {
    const agent = {
      tools: { write: true, skill: true },
      permission: { skill: { '*': 'deny', summarize: 'allow' } },
    }
    const result = setAgentSkillIds(agent, [])
    expect(result.tools?.skill).toBeUndefined()
    expect(result.permission).toBeUndefined()
  })

  it('deduplicates and sorts skill ids', () => {
    const agent = { tools: {} }
    const result = setAgentSkillIds(agent, ['z-skill', 'a-skill', 'z-skill'])
    expect(result.permission).toEqual({
      skill: { '*': 'deny', 'a-skill': 'allow', 'z-skill': 'allow' },
    })
  })
})

describe('getAssignedAgentIdsForSkill', () => {
  it('returns agent ids that have the skill enabled', () => {
    const config: CommonWorkspaceConfig = {
      default_agent: 'a',
      agent: {
        a: {
          tools: { skill: true },
          permission: { skill: { '*': 'deny', 'my-skill': 'allow' } },
        },
        b: { tools: { write: true } },
      },
    }
    expect(getAssignedAgentIdsForSkill(config, 'my-skill')).toEqual(['a'])
  })

  it('returns empty array when no agents have the skill', () => {
    const config: CommonWorkspaceConfig = {
      default_agent: 'a',
      agent: { a: {} },
    }
    expect(getAssignedAgentIdsForSkill(config, 'unknown')).toEqual([])
  })
})

describe('setSkillAssignments', () => {
  it('assigns skill to specified agents only', () => {
    const config: CommonWorkspaceConfig = {
      default_agent: 'a',
      agent: {
        a: { tools: {} },
        b: { tools: {} },
      },
    }
    const result = setSkillAssignments(config, 'my-skill', ['b'])
    const summaries = getAgentSummaries(result)
    const agentA = summaries.find((s) => s.id === 'a')
    const agentB = summaries.find((s) => s.id === 'b')
    expect(agentA?.capabilities.skillIds).toEqual([])
    expect(agentB?.capabilities.skillIds).toEqual(['my-skill'])
  })

  it('removes skill from agents not in the list', () => {
    const config: CommonWorkspaceConfig = {
      default_agent: 'a',
      agent: {
        a: {
          tools: { skill: true },
          permission: { skill: { '*': 'deny', 'my-skill': 'allow' } },
        },
      },
    }
    const result = setSkillAssignments(config, 'my-skill', [])
    const summaries = getAgentSummaries(result)
    expect(summaries[0].capabilities.skillIds).toEqual([])
  })
})

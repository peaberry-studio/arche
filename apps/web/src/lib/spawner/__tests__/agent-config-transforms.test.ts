import { describe, it, expect } from 'vitest'


import { injectSelfDelegationGuards, remapAgentConnectorTools } from '../agent-config-transforms'

describe('injectSelfDelegationGuards', () => {
  it('injects guard into sub-agent with task: true', () => {
    const config = {
      agent: {
        assistant: { mode: 'primary', prompt: 'You are helpful.', tools: { task: true } },
        linear: { mode: 'subagent', prompt: 'Handle Linear.', tools: { task: true, bash: true } },
      },
    }

    const result = injectSelfDelegationGuards(config) as typeof config
    const linearPrompt = result.agent.linear.prompt as string

    expect(linearPrompt).toContain('## Delegation constraint')
    expect(linearPrompt).toContain('MUST NEVER use the task tool to invoke yourself ("linear")')
    expect(linearPrompt).toContain('You may delegate to: assistant.')
    expect(linearPrompt).toMatch(/^Handle Linear\./)
  })

  it('does not modify primary agents', () => {
    const config = {
      agent: {
        assistant: { mode: 'primary', prompt: 'You are helpful.', tools: { task: true } },
      },
    }

    const result = injectSelfDelegationGuards(config) as typeof config
    expect(result.agent.assistant.prompt).toBe('You are helpful.')
  })

  it('does not modify agents without task tool', () => {
    const config = {
      agent: {
        reader: { mode: 'subagent', prompt: 'Read files.', tools: { read: true } },
      },
    }

    const result = injectSelfDelegationGuards(config) as typeof config
    expect(result.agent.reader.prompt).toBe('Read files.')
  })

  it('injects guard into agents with mode "all" and task: true', () => {
    const config = {
      agent: {
        assistant: { mode: 'primary', prompt: 'Primary.', tools: { task: true } },
        utils: { mode: 'all', prompt: 'Utilities.', tools: { task: true } },
      },
    }

    const result = injectSelfDelegationGuards(config) as typeof config
    const utilsPrompt = result.agent.utils.prompt as string

    expect(utilsPrompt).toContain('## Delegation constraint')
    expect(utilsPrompt).toContain('"utils"')
  })

  it('handles empty or undefined prompt gracefully', () => {
    const config = {
      agent: {
        assistant: { mode: 'primary', tools: { task: true } },
        worker: { mode: 'subagent', tools: { task: true } },
      },
    }

    const result = injectSelfDelegationGuards(config)
    const agents = result.agent as Record<string, Record<string, unknown>>
    const workerPrompt = agents.worker.prompt as string

    expect(workerPrompt).toContain('## Delegation constraint')
  })

  it('lists all other agents in the delegation list', () => {
    const config = {
      agent: {
        assistant: { mode: 'primary', prompt: 'Primary.', tools: { task: true } },
        linear: { mode: 'subagent', prompt: 'Linear.', tools: { task: true } },
        notion: { mode: 'subagent', prompt: 'Notion.', tools: { task: true } },
      },
    }

    const result = injectSelfDelegationGuards(config)
    const agents = result.agent as Record<string, Record<string, unknown>>
    const linearPrompt = agents.linear.prompt as string

    expect(linearPrompt).toContain('assistant, notion')
  })

  it('returns config unchanged when no agents exist', () => {
    const config = { default_agent: 'assistant' }
    const result = injectSelfDelegationGuards(config)
    expect(result).toBe(config)
  })

  it('does not modify agents with task: false', () => {
    const config = {
      agent: {
        worker: { mode: 'subagent', prompt: 'Worker.', tools: { task: false, bash: true } },
      },
    }

    const result = injectSelfDelegationGuards(config) as typeof config
    expect(result.agent.worker.prompt).toBe('Worker.')
  })
})

describe('remapAgentConnectorTools', () => {
  it('remaps admin connector ID to user connector ID', () => {
    const config = {
      agent: {
        linear: {
          mode: 'subagent',
          tools: {
            task: true,
            'arche_*': false,
            'arche_linear_abc123_*': true,
          },
        },
      },
    }
    const userKeys = new Set(['arche_linear_xyz789'])

    const result = remapAgentConnectorTools(config, userKeys)
    const tools = (result.agent as Record<string, Record<string, unknown>>).linear.tools as Record<string, boolean>

    expect(tools['arche_linear_xyz789_*']).toBe(true)
    expect(tools['arche_linear_abc123_*']).toBeUndefined()
    expect(tools.task).toBe(true)
    expect(tools['arche_*']).toBe(false)
  })

  it('remaps multiple types independently', () => {
    const config = {
      agent: {
        worker: {
          tools: {
            'arche_linear_aaa_*': true,
            'arche_notion_bbb_*': true,
          },
        },
      },
    }
    const userKeys = new Set(['arche_linear_111', 'arche_notion_222'])

    const result = remapAgentConnectorTools(config, userKeys)
    const tools = (result.agent as Record<string, Record<string, unknown>>).worker.tools as Record<string, boolean>

    expect(tools['arche_linear_111_*']).toBe(true)
    expect(tools['arche_notion_222_*']).toBe(true)
    expect(tools['arche_linear_aaa_*']).toBeUndefined()
    expect(tools['arche_notion_bbb_*']).toBeUndefined()
  })

  it('removes MCP references when user has no connector of that type', () => {
    const config = {
      agent: {
        linear: {
          tools: {
            task: true,
            'arche_linear_abc123_*': true,
          },
        },
      },
    }
    const userKeys = new Set<string>()

    const result = remapAgentConnectorTools(config, userKeys)
    const tools = (result.agent as Record<string, Record<string, unknown>>).linear.tools as Record<string, boolean>

    expect(tools['arche_linear_abc123_*']).toBeUndefined()
    expect(tools.task).toBe(true)
  })

  it('adds all user connectors when user has multiple custom connectors', () => {
    const config = {
      agent: {
        worker: {
          tools: {
            'arche_custom_admin1_*': true,
          },
        },
      },
    }
    const userKeys = new Set(['arche_custom_user1', 'arche_custom_user2'])

    const result = remapAgentConnectorTools(config, userKeys)
    const tools = (result.agent as Record<string, Record<string, unknown>>).worker.tools as Record<string, boolean>

    expect(tools['arche_custom_user1_*']).toBe(true)
    expect(tools['arche_custom_user2_*']).toBe(true)
    expect(tools['arche_custom_admin1_*']).toBeUndefined()
  })

  it('preserves arche_*: false', () => {
    const config = {
      agent: {
        worker: {
          tools: {
            'arche_*': false,
            'arche_linear_abc_*': true,
          },
        },
      },
    }
    const userKeys = new Set(['arche_linear_xyz'])

    const result = remapAgentConnectorTools(config, userKeys)
    const tools = (result.agent as Record<string, Record<string, unknown>>).worker.tools as Record<string, boolean>

    expect(tools['arche_*']).toBe(false)
  })

  it('preserves non-MCP tools', () => {
    const config = {
      agent: {
        worker: {
          tools: {
            task: true,
            bash: true,
            read: false,
            'arche_linear_abc_*': true,
          },
        },
      },
    }
    const userKeys = new Set(['arche_linear_xyz'])

    const result = remapAgentConnectorTools(config, userKeys)
    const tools = (result.agent as Record<string, Record<string, unknown>>).worker.tools as Record<string, boolean>

    expect(tools.task).toBe(true)
    expect(tools.bash).toBe(true)
    expect(tools.read).toBe(false)
  })

  it('removes all MCP references when userMcpKeys is empty', () => {
    const config = {
      agent: {
        worker: {
          tools: {
            task: true,
            'arche_linear_abc_*': true,
            'arche_notion_def_*': true,
          },
        },
      },
    }
    const userKeys = new Set<string>()

    const result = remapAgentConnectorTools(config, userKeys)
    const tools = (result.agent as Record<string, Record<string, unknown>>).worker.tools as Record<string, boolean>

    expect(tools.task).toBe(true)
    expect(tools['arche_linear_abc_*']).toBeUndefined()
    expect(tools['arche_notion_def_*']).toBeUndefined()
  })

  it('is a no-op when admin and user IDs match', () => {
    const config = {
      agent: {
        worker: {
          tools: {
            'arche_linear_same123_*': true,
          },
        },
      },
    }
    const userKeys = new Set(['arche_linear_same123'])

    const result = remapAgentConnectorTools(config, userKeys)
    expect(result).toBe(config)
  })

  it('returns config unchanged when no agents exist', () => {
    const config = { default_agent: 'assistant' }
    const result = remapAgentConnectorTools(config, new Set(['arche_linear_xyz']))
    expect(result).toBe(config)
  })

  it('skips agents without tools', () => {
    const config = {
      agent: {
        worker: { mode: 'subagent', prompt: 'Hello' },
      },
    }
    const result = remapAgentConnectorTools(config, new Set(['arche_linear_xyz']))
    expect(result).toBe(config)
  })
})

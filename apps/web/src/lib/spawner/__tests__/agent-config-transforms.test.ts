import { describe, it, expect } from 'vitest'


import {
  applyDefaultAgentModel,
  injectAlwaysOnAgentTools,
  injectSelfDelegationGuards,
  remapAgentConnectorTools,
} from '../agent-config-transforms'

describe('applyDefaultAgentModel', () => {
  it('injects default_model into agents without model', () => {
    const config = {
      default_model: 'openai/gpt-5.5',
      agent: {
        assistant: { mode: 'primary' },
      },
    }

    const result = applyDefaultAgentModel(config)
    const agents = result.agent as Record<string, Record<string, unknown>>

    expect(agents.assistant.model).toBe('openai/gpt-5.5')
    expect(result.default_model).toBeUndefined()
  })

  it('preserves explicit agent model overrides', () => {
    const config = {
      default_model: 'openai/gpt-5.5',
      agent: {
        assistant: { mode: 'primary', model: 'anthropic/claude-sonnet-4' },
      },
    }

    const result = applyDefaultAgentModel(config)
    const agents = result.agent as Record<string, Record<string, unknown>>
    expect(agents.assistant.model).toBe('anthropic/claude-sonnet-4')
    expect(result.default_model).toBeUndefined()
  })

  it('returns config unchanged without default_model', () => {
    const config = {
      agent: {
        assistant: { mode: 'primary' },
      },
    }

    const result = applyDefaultAgentModel(config)
    expect(result).toBe(config)
  })

  it('preserves non-record agent entries', () => {
    const config = {
      default_model: 'openai/gpt-5.5',
      agent: {
        assistant: null,
        helper: { mode: 'subagent' },
      },
    }

    const result = applyDefaultAgentModel(config)
    const agents = result.agent as Record<string, Record<string, unknown> | null>

    expect(agents.assistant).toBeNull()
    expect(agents.helper?.model).toBe('openai/gpt-5.5')
    expect(result.default_model).toBeUndefined()
  })
})

describe('injectAlwaysOnAgentTools', () => {
  it('enables always-on tools for every configured agent', () => {
    const config = {
      agent: {
        assistant: { mode: 'primary', tools: { task: true, email_draft: false } },
        support: { mode: 'subagent', tools: { read: true } },
      },
    }

    const result = injectAlwaysOnAgentTools(config)
    const agents = result.agent as Record<string, Record<string, unknown>>
    const assistantTools = agents.assistant.tools as Record<string, boolean>
    const supportTools = agents.support.tools as Record<string, boolean>

    expect(assistantTools.email_draft).toBe(true)
    expect(assistantTools.chart_create).toBe(true)
    expect(assistantTools.diagram_create).toBe(true)
    expect(supportTools.email_draft).toBe(true)
    expect(supportTools.chart_create).toBe(true)
    expect(supportTools.diagram_create).toBe(true)
  })

  it('skips agents that do not define explicit tools', () => {
    const config = {
      agent: {
        assistant: { mode: 'primary', prompt: 'You are helpful.' },
      },
    }

    const result = injectAlwaysOnAgentTools(config)
    expect(result).toBe(config)
  })

  it('returns the original object when all agents already have always-on tools enabled', () => {
    const config = {
      agent: {
        assistant: {
          mode: 'primary',
          tools: { email_draft: true, chart_create: true, diagram_create: true },
        },
      },
    }

    const result = injectAlwaysOnAgentTools(config)
    expect(result).toBe(config)
  })
})

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

  it('keeps custom connector access scoped to the exact connector id', () => {
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

    expect(tools['arche_custom_admin1_*']).toBeUndefined()
  })

  it('preserves custom connector access when the exact connector exists', () => {
    const config = {
      agent: {
        worker: {
          tools: {
            'arche_custom_sameconnector_*': true,
          },
        },
      },
    }

    const result = remapAgentConnectorTools(config, new Set(['arche_custom_sameconnector']))
    expect(result).toBe(config)
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

  it('expands remapped connector wildcard to exact tools when tool permissions exist', () => {
    const config = {
      agent: {
        linear: {
          tools: {
            task: true,
            'arche_*': false,
            'arche_linear_admin123_*': true,
          },
          permission: { bash: 'deny' },
        },
      },
    }
    const result = remapAgentConnectorTools(
      config,
      new Set(['arche_linear_user123']),
      {
        arche_linear_user123: {
          list_issues: 'allow',
          create_issue: 'ask',
        },
      },
    )
    const agent = (result.agent as Record<string, Record<string, unknown>>).linear
    const tools = agent.tools as Record<string, boolean>
    const permission = agent.permission as Record<string, unknown>

    expect(tools['arche_linear_user123_*']).toBeUndefined()
    expect(tools['arche_linear_user123_list_issues']).toBe(true)
    expect(tools['arche_linear_user123_create_issue']).toBe(true)
    expect(tools['arche_*']).toBe(false)
    expect(tools.task).toBe(true)
    expect(permission.bash).toBe('deny')
    expect(permission['arche_linear_user123_list_issues']).toBe('allow')
    expect(permission['arche_linear_user123_create_issue']).toBe('ask')
  })

  it('keeps exact connector permissions after string catch-all permissions', () => {
    const config = {
      agent: {
        linear: {
          tools: {
            'arche_linear_admin123_*': true,
          },
          permission: 'deny',
        },
      },
    }

    const result = remapAgentConnectorTools(
      config,
      new Set(['arche_linear_user123']),
      { arche_linear_user123: { list_issues: 'allow' } },
    )
    const agent = (result.agent as Record<string, Record<string, unknown>>).linear
    const permission = agent.permission as Record<string, unknown>

    expect(Object.keys(permission)).toEqual(['*', 'arche_linear_user123_list_issues'])
    expect(permission).toEqual({
      '*': 'deny',
      arche_linear_user123_list_issues: 'allow',
    })
  })

  it('expands exact custom connector wildcard when tool permissions exist', () => {
    const config = {
      agent: {
        worker: {
          tools: {
            'arche_custom_sameconnector_*': true,
          },
        },
      },
    }

    const result = remapAgentConnectorTools(
      config,
      new Set(['arche_custom_sameconnector']),
      { arche_custom_sameconnector: { sync: 'deny' } },
    )
    const agent = (result.agent as Record<string, Record<string, unknown>>).worker
    const tools = agent.tools as Record<string, boolean>
    const permission = agent.permission as Record<string, unknown>

    expect(tools['arche_custom_sameconnector_*']).toBeUndefined()
    expect(tools['arche_custom_sameconnector_sync']).toBe(true)
    expect(permission['arche_custom_sameconnector_sync']).toBe('deny')
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

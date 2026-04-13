import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: vi.fn(),
}))

import { readCommonWorkspaceConfig } from '@/lib/common-workspace-config-store'
import {
  listAgents,
  readAgent,
} from '../agents'

const mockReadCommonWorkspaceConfig = vi.mocked(readCommonWorkspaceConfig)

describe('mcp agent tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists workspace agents ordered with the primary agent first', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        default_agent: 'assistant',
        agent: {
          reviewer: {
            description: 'Reviews code changes',
            display_name: 'Reviewer',
            mode: 'subagent',
            permission: {
              skill: {
                '*': 'deny',
                lint: 'allow',
              },
            },
            prompt: 'Review the diff carefully.',
            tools: {
              read: true,
              skill: true,
            },
          },
          assistant: {
            description: 'Helps with general tasks',
            display_name: 'Assistant',
            mode: 'primary',
            model: 'openai/gpt-5.2',
            prompt: 'Help the user.',
            temperature: 0.2,
            tools: {
              bash: true,
              edit: true,
              write: true,
            },
          },
        },
      }),
      hash: 'hash-1',
      path: '/kb-config#CommonWorkspaceConfig.json',
    })

    const result = await listAgents()

    expect(result).toEqual({
      ok: true,
      agents: [
        {
          capabilities: {
            mcpConnectorIds: [],
            skillIds: [],
            tools: ['bash', 'edit', 'write'],
          },
          description: 'Helps with general tasks',
          displayName: 'Assistant',
          id: 'assistant',
          isPrimary: true,
          mode: 'primary',
          model: 'openai/gpt-5.2',
          temperature: 0.2,
        },
        {
          capabilities: {
            mcpConnectorIds: [],
            skillIds: ['lint'],
            tools: ['read'],
          },
          description: 'Reviews code changes',
          displayName: 'Reviewer',
          id: 'reviewer',
          isPrimary: false,
          mode: 'subagent',
          model: undefined,
          temperature: undefined,
        },
      ],
      hash: 'hash-1',
    })
  })

  it('returns a single agent including its prompt', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        default_agent: 'assistant',
        agent: {
          assistant: {
            display_name: 'Assistant',
            mode: 'primary',
            prompt: 'Help the user.',
            tools: {
              read: true,
            },
          },
        },
      }),
      hash: 'hash-2',
      path: '/kb-config#CommonWorkspaceConfig.json',
    })

    const result = await readAgent('assistant')

    expect(result).toEqual({
      ok: true,
      agent: {
        capabilities: {
          mcpConnectorIds: [],
          skillIds: [],
          tools: ['read'],
        },
        description: undefined,
        displayName: 'Assistant',
        id: 'assistant',
        isPrimary: true,
        mode: 'primary',
        model: undefined,
        prompt: 'Help the user.',
        temperature: undefined,
      },
      hash: 'hash-2',
    })
  })

  it('returns not_found when the requested agent does not exist', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        default_agent: 'assistant',
        agent: {
          assistant: {
            display_name: 'Assistant',
            mode: 'primary',
            prompt: 'Help the user.',
            tools: {
              read: true,
            },
          },
        },
      }),
      hash: 'hash-3',
      path: '/kb-config#CommonWorkspaceConfig.json',
    })

    await expect(readAgent('reviewer')).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('surfaces invalid configuration errors', async () => {
    mockReadCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: '{"default_agent":"assistant"}',
      hash: 'hash-4',
      path: '/kb-config#CommonWorkspaceConfig.json',
    })

    await expect(listAgents()).resolves.toEqual({ ok: false, error: 'invalid_config' })
  })
})

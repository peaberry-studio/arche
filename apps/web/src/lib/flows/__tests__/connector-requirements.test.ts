import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FlowDefinition } from '@/lib/flows/types'

const mocks = vi.hoisted(() => ({
  findEnabledByUserId: vi.fn(),
  findManyByIds: vi.fn(),
  readCommonWorkspaceConfig: vi.fn(),
}))

vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: mocks.readCommonWorkspaceConfig,
}))

vi.mock('@/lib/services', () => ({
  connectorService: {
    findEnabledByUserId: mocks.findEnabledByUserId,
    findManyByIds: mocks.findManyByIds,
  },
}))

import {
  checkMissingConnectorRequirements,
  getFlowConnectorRequirements,
} from '@/lib/flows/connector-requirements'

const definition: FlowDefinition = {
  edges: [],
  nodes: [
    {
      compactOutput: false,
      id: 'agent-1',
      name: 'Default agent step',
      promptTemplate: 'Start',
      targetAgentId: null,
      type: 'agent',
    },
    {
      compactOutput: false,
      id: 'agent-2',
      name: 'Research step',
      promptTemplate: 'Research',
      targetAgentId: 'researcher',
      type: 'agent',
    },
  ],
  startNodeId: 'agent-1',
  version: 1,
}

describe('flow connector requirements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readCommonWorkspaceConfig.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        default_agent: 'assistant',
        agent: {
          assistant: {
            display_name: 'Assistant',
            mode: 'primary',
            tools: { 'arche_zendesk_globalzendesk_*': true },
          },
          researcher: {
            display_name: 'Researcher',
            mode: 'subagent',
            tools: { 'arche_custom_custom1_*': true },
          },
        },
      }),
    })
    mocks.findManyByIds.mockResolvedValue([{ id: 'custom1', name: 'Acme MCP', type: 'custom' }])
  })

  it('infers requirements from primary and targeted agent capabilities', async () => {
    const result = await getFlowConnectorRequirements(definition)

    expect(result).toEqual({
      ok: true,
      requirements: [
        expect.objectContaining({ agentId: 'assistant', agentName: 'Assistant', capabilityId: 'globalzendesk', connectorType: 'zendesk' }),
        expect.objectContaining({ agentId: 'researcher', agentName: 'Researcher', capabilityId: 'custom1', connectorName: 'Acme MCP', connectorType: 'custom' }),
      ],
    })
  })

  it('checks requirements against the execution user enabled connectors', async () => {
    const requirementsResult = await getFlowConnectorRequirements(definition)
    expect(requirementsResult.ok).toBe(true)
    if (!requirementsResult.ok) return

    mocks.findEnabledByUserId.mockResolvedValue([
      { enabled: true, id: 'zendesk-1', name: 'Zendesk', type: 'zendesk' },
      { enabled: true, id: 'custom2', name: 'Acme MCP', type: 'custom' },
    ])

    await expect(checkMissingConnectorRequirements(requirementsResult.requirements, 'user-1'))
      .resolves.toEqual([])

    mocks.findEnabledByUserId.mockResolvedValue([{ enabled: true, id: 'zendesk-1', name: 'Zendesk', type: 'zendesk' }])

    await expect(checkMissingConnectorRequirements(requirementsResult.requirements, 'user-1'))
      .resolves.toEqual([expect.objectContaining({ capabilityId: 'custom1', connectorType: 'custom' })])
  })

  it('treats duplicate custom connector name matches as missing', async () => {
    const requirementsResult = await getFlowConnectorRequirements(definition)
    expect(requirementsResult.ok).toBe(true)
    if (!requirementsResult.ok) return

    mocks.findEnabledByUserId.mockResolvedValue([
      { enabled: true, id: 'zendesk-1', name: 'Zendesk', type: 'zendesk' },
      { enabled: true, id: 'custom2', name: 'Acme MCP', type: 'custom' },
      { enabled: true, id: 'custom3', name: 'Acme MCP', type: 'custom' },
    ])

    await expect(checkMissingConnectorRequirements(requirementsResult.requirements, 'user-1'))
      .resolves.toEqual([expect.objectContaining({ capabilityId: 'custom1', connectorType: 'custom' })])
  })

  it('surfaces config loading failures instead of silently allowing runs', async () => {
    mocks.readCommonWorkspaceConfig.mockResolvedValue({ ok: false, error: 'kb_unavailable' })

    await expect(getFlowConnectorRequirements(definition)).resolves.toEqual({ ok: false, error: 'kb_unavailable' })
  })
})

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
      requiredConnectors: ['globalzendesk'],
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
    {
      compactOutput: false,
      id: 'agent-3',
      name: 'Declared step',
      promptTemplate: 'Declared',
      requiredConnectors: ['custom1', 'missingcuid'],
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
    mocks.findManyByIds.mockImplementation(async (ids: string[]) => [
      { id: 'custom1', name: 'Acme MCP', type: 'custom' },
      { id: 'globalzendesk', name: 'Zendesk', type: 'zendesk' },
    ].filter((connector) => ids.includes(connector.id)))
  })

  it('derives requirements only from declared step connectors', async () => {
    const result = await getFlowConnectorRequirements(definition)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.requirements).toEqual([
      expect.objectContaining({ agentId: 'assistant', agentName: 'Assistant', capabilityId: 'globalzendesk', connectorName: 'Zendesk', connectorType: 'zendesk' }),
      expect.objectContaining({ agentId: 'researcher', agentName: 'Researcher', capabilityId: 'custom1', connectorName: 'Acme MCP', connectorType: 'custom' }),
      expect.objectContaining({ agentId: 'researcher', agentName: 'Researcher', capabilityId: 'missingcuid' }),
    ])
    // The research step (agent-2) declares nothing, so its agent-tool list never appears.
    expect(mocks.findManyByIds).toHaveBeenCalledWith(expect.arrayContaining(['custom1', 'globalzendesk', 'missingcuid']))
  })

  it('emits no requirements when steps declare nothing even if agents have connector tools', async () => {
    const undeclared: FlowDefinition = {
      ...definition,
      nodes: definition.nodes.map((node) => node.type === 'agent'
        ? { ...node, requiredConnectors: undefined }
        : node),
    }

    await expect(getFlowConnectorRequirements(undeclared)).resolves.toEqual({
      ok: true,
      requirements: [],
    })
    expect(mocks.findManyByIds).not.toHaveBeenCalled()
  })

  it('keeps a raw capability id for declared ids without a connector record', async () => {
    const result = await getFlowConnectorRequirements(definition)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const unknown = result.requirements.find((requirement) => requirement.capabilityId === 'missingcuid')
    expect(unknown).toEqual(expect.objectContaining({
      agentId: 'researcher',
      capabilityId: 'missingcuid',
      connectorType: 'custom',
    }))
  })

  it('blocks declared requirements missing for the execution user', async () => {
    const requirementsResult = await getFlowConnectorRequirements(definition)
    expect(requirementsResult.ok).toBe(true)
    if (!requirementsResult.ok) return

    mocks.findEnabledByUserId.mockResolvedValue([
      { enabled: true, id: 'globalzendesk', name: 'Zendesk', type: 'zendesk' },
      { enabled: true, id: 'custom1', name: 'Acme MCP', type: 'custom' },
      { enabled: true, id: 'missingcuid', name: 'Same Id', type: 'custom' },
    ])

    await expect(checkMissingConnectorRequirements(requirementsResult.requirements, 'user-1'))
      .resolves.toEqual([])

    mocks.findEnabledByUserId.mockResolvedValue([{ enabled: true, id: 'globalzendesk', name: 'Zendesk', type: 'zendesk' }])

    await expect(checkMissingConnectorRequirements(requirementsResult.requirements, 'user-1'))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ capabilityId: 'custom1', connectorType: 'custom' }),
        expect.objectContaining({ capabilityId: 'missingcuid' }),
      ]))
  })

  it('treats duplicate custom connector name matches as missing', async () => {
    const requirementsResult = await getFlowConnectorRequirements(definition)
    expect(requirementsResult.ok).toBe(true)
    if (!requirementsResult.ok) return

    mocks.findEnabledByUserId.mockResolvedValue([
      { enabled: true, id: 'custom2', name: 'Acme MCP', type: 'custom' },
      { enabled: true, id: 'custom3', name: 'Acme MCP', type: 'custom' },
      { enabled: true, id: 'globalzendesk', name: 'Zendesk', type: 'zendesk' },
    ])

    await expect(checkMissingConnectorRequirements(requirementsResult.requirements, 'user-1'))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'custom1', connectorType: 'custom' })]))
    const result2 = await checkMissingConnectorRequirements(requirementsResult.requirements, 'user-1')
    expect(result2.map((requirement) => requirement.capabilityId)).toContain('missingcuid')
  })

  it('surfaces config loading failures instead of silently allowing runs', async () => {
    mocks.readCommonWorkspaceConfig.mockResolvedValue({ ok: false, error: 'kb_unavailable' })

    await expect(getFlowConnectorRequirements(definition)).resolves.toEqual({ ok: false, error: 'kb_unavailable' })
  })
})

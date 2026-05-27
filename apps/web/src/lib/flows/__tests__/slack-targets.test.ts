import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findIntegration: vi.fn(),
  findTeamMemberById: vi.fn(),
  listEnabledNotificationChannels: vi.fn(),
}))

vi.mock('@/lib/services', () => ({
  slackService: {
    findIntegration: mocks.findIntegration,
    listEnabledNotificationChannels: mocks.listEnabledNotificationChannels,
  },
  userService: {
    findTeamMemberById: mocks.findTeamMemberById,
  },
}))

import { analyzeFlowSlackTargets } from '@/lib/flows/slack-targets'
import type { FlowDefinition, FlowSlackTarget } from '@/lib/flows/types'

function definitionWithSlackTargets(targets: FlowSlackTarget[]): FlowDefinition {
  return {
    edges: [],
    nodes: targets.map((target, index) => ({
      id: `slack-${index}`,
      messageMode: 'fixed',
      messageTemplate: 'Hello',
      name: `Slack ${index}`,
      target,
      type: 'slack',
    })),
    startNodeId: 'slack-0',
    version: 1,
  }
}

describe('analyzeFlowSlackTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findIntegration.mockResolvedValue({ enabled: true, slackTeamId: 'T123' })
    mocks.findTeamMemberById.mockResolvedValue({ id: 'user-2' })
    mocks.listEnabledNotificationChannels.mockResolvedValue([
      { channelId: 'C-public', isPrivate: false },
      { channelId: 'C-private', isPrivate: true },
    ])
  })

  it('returns no issues when a definition has no Slack targets', async () => {
    await expect(analyzeFlowSlackTargets(undefined, { id: 'user-1', role: 'USER' }, 'user-1'))
      .resolves.toEqual([])
  })

  it('reports disabled integration and forbidden targets with node context', async () => {
    mocks.findIntegration.mockResolvedValueOnce({ enabled: false, slackTeamId: 'T123' })
    await expect(analyzeFlowSlackTargets(
      definitionWithSlackTargets([{ channelId: 'C-public', type: 'channel' }]),
      { id: 'user-1', role: 'USER' },
      'user-1',
    )).resolves.toEqual([{ code: 'slack_integration_disabled' }])

    await expect(analyzeFlowSlackTargets(
      definitionWithSlackTargets([{ channelId: 'C-private', type: 'channel' }]),
      { id: 'user-1', role: 'USER' },
      'user-1',
    )).resolves.toEqual([{
      code: 'slack_private_channel_forbidden',
      nodeId: 'slack-0',
      nodeName: 'Slack 0',
      value: 'C-private',
    }])
  })
})

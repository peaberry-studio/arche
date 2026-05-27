import type { FlowDefinition, FlowSlackTarget } from '@/lib/flows/types'
import { slackService, userService } from '@/lib/services'

export type FlowSlackTargetIssueCode =
  | 'slack_dm_target_forbidden'
  | 'slack_integration_disabled'
  | 'slack_private_channel_forbidden'
  | 'unknown_slack_channel_target'
  | 'unknown_slack_dm_target'

export type FlowSlackTargetIssue = {
  code: FlowSlackTargetIssueCode
  nodeId?: string
  nodeName?: string
  value?: string
}

type FlowSlackTargetEntry = {
  nodeId: string
  nodeName: string
  target: FlowSlackTarget
}

function getSlackTargetEntries(definition: FlowDefinition | null | undefined): FlowSlackTargetEntry[] {
  if (!definition) return []

  return definition.nodes.flatMap((node) => (
    node.type === 'slack'
      ? [{ nodeId: node.id, nodeName: node.name, target: node.target }]
      : []
  ))
}

export async function analyzeFlowSlackTargets(
  definition: FlowDefinition | null | undefined,
  contextUser: { id: string; role: string },
  flowOwnerUserId: string,
): Promise<FlowSlackTargetIssue[]> {
  const entries = getSlackTargetEntries(definition)
  if (entries.length === 0) return []

  const integration = await slackService.findIntegration()
  if (!integration?.enabled || !integration.slackTeamId) {
    return [{ code: 'slack_integration_disabled' }]
  }

  const issues: FlowSlackTargetIssue[] = []
  const channelEntries = entries.filter((entry) => entry.target.type === 'channel')
  const channelsById = new Map<string, { isPrivate: boolean }>()
  if (channelEntries.length > 0) {
    const channels = await slackService.listEnabledNotificationChannels(integration.slackTeamId)
    for (const channel of channels) {
      channelsById.set(channel.channelId, { isPrivate: channel.isPrivate })
    }
  }

  for (const entry of entries) {
    if (entry.target.type === 'dm') {
      if (contextUser.role !== 'ADMIN' && entry.target.userId !== flowOwnerUserId) {
        issues.push({
          code: 'slack_dm_target_forbidden',
          nodeId: entry.nodeId,
          nodeName: entry.nodeName,
          value: entry.target.userId,
        })
        continue
      }

      if (contextUser.role === 'ADMIN') {
        const member = await userService.findTeamMemberById(entry.target.userId)
        if (!member) {
          issues.push({
            code: 'unknown_slack_dm_target',
            nodeId: entry.nodeId,
            nodeName: entry.nodeName,
            value: entry.target.userId,
          })
        }
      }
      continue
    }

    const channel = channelsById.get(entry.target.channelId)
    if (!channel) {
      issues.push({
        code: 'unknown_slack_channel_target',
        nodeId: entry.nodeId,
        nodeName: entry.nodeName,
        value: entry.target.channelId,
      })
      continue
    }

    if (contextUser.role !== 'ADMIN' && channel.isPrivate) {
      issues.push({
        code: 'slack_private_channel_forbidden',
        nodeId: entry.nodeId,
        nodeName: entry.nodeName,
        value: entry.target.channelId,
      })
    }
  }

  return issues
}

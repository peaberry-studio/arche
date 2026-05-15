import type { FlowDefinition, FlowSlackTarget } from '@/lib/flows/types'
import { slackService, userService } from '@/lib/services'

type FlowSlackNodeAccessResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 403 }

function getSlackTargets(definition: FlowDefinition | null | undefined): FlowSlackTarget[] {
  if (!definition) return []

  return definition.nodes.flatMap((node) => node.type === 'slack' ? [node.target] : [])
}

export async function validateFlowSlackNodeAccess(
  definition: FlowDefinition | null | undefined,
  contextUser: { id: string; role: string },
  flowOwnerUserId: string,
): Promise<FlowSlackNodeAccessResult> {
  const targets = getSlackTargets(definition)
  if (targets.length === 0) return { ok: true }

  const integration = await slackService.findIntegration()
  if (!integration?.enabled || !integration.slackTeamId) {
    return { ok: false, error: 'slack_integration_disabled', status: 400 }
  }

  for (const target of targets) {
    if (target.type !== 'dm') {
      continue
    }

    if (contextUser.role !== 'ADMIN') {
      if (target.userId !== flowOwnerUserId) {
        return { ok: false, error: 'slack_notification_dm_target_forbidden', status: 403 }
      }
      continue
    }

    const member = await userService.findTeamMemberById(target.userId)
    if (!member) {
      return { ok: false, error: 'unknown_slack_notification_dm_target', status: 400 }
    }
  }

  const channelTargets = targets.flatMap((target) => (
    target.type === 'channel' ? [target] : []
  ))
  if (channelTargets.length === 0) {
    return { ok: true }
  }

  const channels = await slackService.listEnabledNotificationChannels(integration.slackTeamId)
  const channelsById = new Map(channels.map((channel) => [channel.channelId, channel]))

  for (const target of channelTargets) {
    const channel = channelsById.get(target.channelId)
    if (!channel) {
      return { ok: false, error: 'unknown_slack_notification_channel_target', status: 400 }
    }

    if (contextUser.role !== 'ADMIN' && channel.isPrivate) {
      return { ok: false, error: 'slack_notification_channel_target_forbidden', status: 403 }
    }
  }

  return { ok: true }
}

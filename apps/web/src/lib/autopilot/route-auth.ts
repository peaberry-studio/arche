import type { AutopilotSlackNotificationConfig } from '@/lib/autopilot/types'
import { slackService, userService } from '@/lib/services'

type AutopilotSlackNotificationAccessResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 403 }

export async function resolveAutopilotWorkspaceUserId(
  slug: string,
  contextUser: { id: string; slug: string },
): Promise<string | null> {
  if (contextUser.slug === slug) {
    return contextUser.id
  }

  const owner = await userService.findIdBySlug(slug)
  return owner?.id ?? null
}

export async function validateAutopilotSlackNotificationAccess(
  config: AutopilotSlackNotificationConfig | null | undefined,
  contextUser: { id: string; role: string },
  taskOwnerUserId: string,
): Promise<AutopilotSlackNotificationAccessResult> {
  if (!config?.enabled) {
    return { ok: true }
  }

  for (const target of config.targets) {
    if (target.type !== 'dm') {
      continue
    }

    if (contextUser.role !== 'ADMIN') {
      if (target.userId !== taskOwnerUserId) {
        return { ok: false, error: 'slack_notification_dm_target_forbidden', status: 403 }
      }
      continue
    }

    const member = await userService.findTeamMemberById(target.userId)
    if (!member) {
      return { ok: false, error: 'unknown_slack_notification_dm_target', status: 400 }
    }
  }

  const channelTargets = config.targets.flatMap((target) => (
    target.type === 'channel' ? [target] : []
  ))
  if (channelTargets.length === 0) {
    return { ok: true }
  }

  const integration = await slackService.findIntegration()
  if (!integration?.enabled || !integration.slackTeamId) {
    return { ok: false, error: 'slack_integration_disabled', status: 400 }
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

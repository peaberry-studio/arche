import { analyzeFlowSlackTargets, type FlowSlackTargetIssue } from '@/lib/flows/slack-targets'
import type { FlowDefinition } from '@/lib/flows/types'

type FlowSlackNodeAccessResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 403 }

function slackIssueRouteError(issue: FlowSlackTargetIssue): { error: string; status: 400 | 403 } {
  if (issue.code === 'slack_dm_target_forbidden') {
    return { error: 'slack_notification_dm_target_forbidden', status: 403 }
  }
  if (issue.code === 'slack_private_channel_forbidden') {
    return { error: 'slack_notification_channel_target_forbidden', status: 403 }
  }
  if (issue.code === 'unknown_slack_channel_target') {
    return { error: 'unknown_slack_notification_channel_target', status: 400 }
  }
  if (issue.code === 'unknown_slack_dm_target') {
    return { error: 'unknown_slack_notification_dm_target', status: 400 }
  }

  return { error: 'slack_integration_disabled', status: 400 }
}

export async function validateFlowSlackNodeAccess(
  definition: FlowDefinition | null | undefined,
  contextUser: { id: string; role: string },
  flowOwnerUserId: string,
): Promise<FlowSlackNodeAccessResult> {
  const [issue] = await analyzeFlowSlackTargets(definition, contextUser, flowOwnerUserId)
  if (!issue) return { ok: true }

  return { ok: false, ...slackIssueRouteError(issue) }
}

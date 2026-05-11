import { prisma } from '@/lib/prisma'
import { auditService, slackService } from '@/lib/services'
import type { SlackNotificationTarget } from '@/lib/services/slack'

type SlackApiObject = Record<string, unknown>

type SlackUserLookupResponse = SlackApiObject & {
  user?: {
    id?: string
    real_name?: string
    profile?: {
      display_name?: string
      email?: string
      real_name?: string
    }
  }
}

type SlackConversationsOpenResponse = SlackApiObject & {
  channel?: {
    id?: string
  }
}

export type SlackNotificationInput = {
  targets: SlackNotificationTarget[]
  text: string
  sessionLink?: string
  source: string
}

export type SlackNotificationResult =
  | {
      ok: true
      sent: number
      failed: number
      errors: Array<{ target: string; error: string }>
    }
  | {
      ok: false
      error: string
    }

export async function sendSlackNotifications(
  input: SlackNotificationInput,
): Promise<SlackNotificationResult> {
  const integration = await slackService.findIntegration()
  if (!integration?.enabled || !integration.botTokenSecret || !integration.slackTeamId) {
    return { ok: false, error: 'slack_integration_disabled' }
  }

  const results = {
    sent: 0,
    failed: 0,
    errors: [] as Array<{ target: string; error: string }>,
  }

  for (const target of input.targets) {
    const targetLabel = formatTargetLabel(target)
    try {
      if (target.type === 'dm') {
        await sendDmNotification({
          botToken: integration.botTokenSecret,
          sessionLink: input.sessionLink,
          slackTeamId: integration.slackTeamId,
          targetUserId: target.userId,
          text: input.text,
        })
      } else {
        await sendChannelNotification({
          botToken: integration.botTokenSecret,
          channelId: target.channelId,
          sessionLink: input.sessionLink,
          slackTeamId: integration.slackTeamId,
          text: input.text,
        })
      }

      results.sent += 1
      await auditService.createEvent({
        action: 'slack.notification_sent',
        metadata: {
          source: input.source,
          target: targetLabel,
        },
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown'
      results.failed += 1
      results.errors.push({ target: targetLabel, error: detail })
      await auditService.createEvent({
        action: 'slack.notification_failed',
        metadata: {
          error: detail,
          source: input.source,
          target: targetLabel,
        },
      })
    }
  }

  return { ok: true, ...results }
}

async function sendDmNotification(args: {
  botToken: string
  slackTeamId: string
  targetUserId: string
  text: string
  sessionLink?: string
}): Promise<void> {
  const user = await prisma.user.findFirst({
    where: {
      id: args.targetUserId,
      kind: 'HUMAN',
    },
    select: {
      email: true,
      id: true,
    },
  })

  if (!user) {
    throw new Error(`User not found: ${args.targetUserId}`)
  }

  let slackUser = await prisma.slackUserLink.findFirst({
    where: {
      slackTeamId: args.slackTeamId,
      userId: user.id,
    },
    orderBy: {
      lastSeenAt: 'desc',
    },
  })

  if (!slackUser) {
    const userInfo = await callSlackApi<SlackUserLookupResponse>(
      'users.lookupByEmail',
      args.botToken,
      { email: user.email },
    )
    const slackUserInfo = userInfo.user
    const slackUserId = slackUserInfo?.id
    if (!slackUserId) {
      throw new Error('Slack user not found by email')
    }

    const profile = slackUserInfo.profile
    slackUser = await slackService.upsertUserLink({
      displayName: profile?.display_name || profile?.real_name || slackUserInfo.real_name || null,
      slackEmail: profile?.email ?? user.email,
      slackTeamId: args.slackTeamId,
      slackUserId,
      userId: user.id,
    })
  }

  const dm = await callSlackApi<SlackConversationsOpenResponse>(
    'conversations.open',
    args.botToken,
    { users: slackUser.slackUserId },
  )
  const dmChannelId = dm.channel?.id
  if (!dmChannelId) {
    throw new Error('Failed to open Slack DM')
  }

  await postSlackMessage(args.botToken, dmChannelId, buildNotificationMessage(args.text, args.sessionLink))
}

async function sendChannelNotification(args: {
  botToken: string
  slackTeamId: string
  channelId: string
  text: string
  sessionLink?: string
}): Promise<void> {
  const allowed = await slackService.isNotificationChannelAllowed(args.slackTeamId, args.channelId)
  if (!allowed) {
    throw new Error('Channel not in allowlist')
  }

  await postSlackMessage(args.botToken, args.channelId, buildNotificationMessage(args.text, args.sessionLink))
}

async function postSlackMessage(botToken: string, channelId: string, text: string): Promise<void> {
  await callSlackApi('chat.postMessage', botToken, {
    channel: channelId,
    text,
  })
}

async function callSlackApi<T extends SlackApiObject>(
  method: string,
  botToken: string,
  body: Record<string, string>,
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })

  const data = await response.json().catch(() => null) as (T & { ok?: boolean; error?: string }) | null
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `slack_${method.replace(/\./g, '_')}_failed`)
  }

  return data
}

function buildNotificationMessage(text: string, sessionLink?: string): string {
  if (!sessionLink) {
    return text
  }

  return `${text}\n\nView session: ${sessionLink}`
}

function formatTargetLabel(target: SlackNotificationTarget): string {
  if (target.type === 'dm') {
    return `dm:${target.userId}`
  }

  return `channel:${target.channelId}`
}

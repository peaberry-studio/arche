import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { slackService } from '@/lib/services'

type SlackConversationListResponse = {
  ok?: boolean
  error?: string
  channels?: Array<{
    id?: string
    is_member?: boolean
    is_private?: boolean
    name?: string
  }>
  response_metadata?: {
    next_cursor?: string
  }
}

type SlackListedChannel = {
  channelId: string
  isPrivate: boolean
  name: string
}

function requireAdmin(user: { id: string; role: string }) {
  const denied = requireCapability('slackIntegration')
  if (denied) {
    return { ok: false as const, response: denied }
  }

  if (user.role !== 'ADMIN') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return { ok: true as const }
}

async function listSlackChannels(botToken: string): Promise<SlackListedChannel[]> {
  const channels = [
    ...(await listSlackChannelsByType(botToken, 'public_channel')),
    ...(await listSlackChannelsByType(botToken, 'private_channel')),
  ]

  const deduped = new Map<string, SlackListedChannel>()
  for (const channel of channels) {
    deduped.set(channel.channelId, channel)
  }

  return Array.from(deduped.values())
}

async function listSlackChannelsByType(botToken: string, type: 'public_channel' | 'private_channel'): Promise<SlackListedChannel[]> {
  const channels: SlackListedChannel[] = []
  let cursor: string | null = null

  do {
    const response = await callSlackConversationsList(botToken, type, cursor)
    for (const channel of response.channels ?? []) {
      if (!channel.id || !channel.name) {
        continue
      }

      const isPrivate = type === 'private_channel' || channel.is_private === true
      if (isPrivate && channel.is_member !== true) {
        continue
      }

      channels.push({
        channelId: channel.id,
        isPrivate,
        name: channel.name,
      })
    }

    const nextCursor = response.response_metadata?.next_cursor?.trim() ?? ''
    cursor = nextCursor || null
  } while (cursor)

  return channels
}

async function callSlackConversationsList(
  botToken: string,
  type: 'public_channel' | 'private_channel',
  cursor: string | null,
): Promise<SlackConversationListResponse> {
  const response = await fetch('https://slack.com/api/conversations.list', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      cursor: cursor ?? undefined,
      exclude_archived: true,
      limit: 200,
      types: type,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })

  const data = await response.json().catch(() => null) as SlackConversationListResponse | null
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? 'slack_conversations_list_failed')
  }

  return data
}

export const GET = withAuth(
  { csrf: false },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) return admin.response

    try {
      const integration = await slackService.findIntegration()
      if (!integration?.enabled || !integration.slackTeamId) {
        return NextResponse.json({ channels: [] })
      }

      const channels = await slackService.listNotificationChannels(integration.slackTeamId)
      return NextResponse.json({ channels })
    } catch (error) {
      console.error('[slack-channels] Failed to load channels', error)
      return NextResponse.json({ error: 'internal_error' }, { status: 500 })
    }
  },
)

export const POST = withAuth(
  { csrf: true },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) return admin.response

    try {
      const integration = await slackService.findIntegration()
      if (!integration?.enabled || !integration.botTokenSecret || !integration.slackTeamId) {
        return NextResponse.json({ error: 'slack_integration_disabled' }, { status: 400 })
      }

      const channels = await listSlackChannels(integration.botTokenSecret)
      await slackService.upsertNotificationChannelsFromSlack(integration.slackTeamId, channels)
      await auditEvent({
        actorUserId: user.id,
        action: 'slack.notification_channels_refreshed',
        metadata: {
          channelCount: channels.length,
          slackTeamId: integration.slackTeamId,
        },
      })

      return NextResponse.json({ ok: true })
    } catch (error) {
      console.error('[slack-channels] Failed to refresh channels', error)
      return NextResponse.json({ error: 'internal_error' }, { status: 500 })
    }
  },
)

export const PATCH = withAuth(
  { csrf: true },
  async (request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) return admin.response

    try {
      const body = await request.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }

      const record = body as Record<string, unknown>
      const channelId = typeof record.channelId === 'string' ? record.channelId.trim() : ''
      const enabled = record.enabled
      if (!channelId || typeof enabled !== 'boolean') {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
      }

      await slackService.setNotificationChannelEnabled(channelId, enabled)
      await auditEvent({
        actorUserId: user.id,
        action: 'slack.notification_channel_updated',
        metadata: {
          channelId,
          enabled,
        },
      })

      return NextResponse.json({ ok: true })
    } catch (error) {
      console.error('[slack-channels] Failed to update channel', error)
      return NextResponse.json({ error: 'internal_error' }, { status: 500 })
    }
  },
)

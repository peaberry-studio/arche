import type { SlackIntegrationRecord } from '@/lib/services/slack'
import type { SlackIntegrationStatus, SlackIntegrationSummary, SlackIntegrationTestResponse } from '@/lib/slack/types'

type SlackApiResponse = {
  ok?: boolean
  bot?: {
    app_id?: string
  }
  bot_id?: string
  error?: string
  app_id?: string
  team_id?: string
  url?: string
  user_id?: string
}

export function getSlackIntegrationStatus(record: SlackIntegrationRecord | null): SlackIntegrationStatus {
  if (!record?.enabled) {
    return 'disabled'
  }
  if (record.lastError) {
    return 'error'
  }
  if (record.lastSocketConnectedAt) {
    return 'connected'
  }

  return 'connecting'
}

export function serializeSlackIntegration(
  record: SlackIntegrationRecord | null,
  primaryAgentId: string | null,
): SlackIntegrationSummary {
  return {
    configured: Boolean(record?.botTokenSecret && record?.appTokenSecret),
    defaultAgentId: record?.defaultAgentId ?? null,
    enabled: record?.enabled ?? false,
    hasAppToken: Boolean(record?.appTokenSecret),
    hasBotToken: Boolean(record?.botTokenSecret),
    lastError: record?.lastError ?? null,
    lastEventAt: record?.lastEventAt?.toISOString() ?? null,
    lastSocketConnectedAt: record?.lastSocketConnectedAt?.toISOString() ?? null,
    resolvedDefaultAgentId: record?.defaultAgentId ?? primaryAgentId,
    slackAppId: record?.slackAppId ?? null,
    slackBotUserId: record?.slackBotUserId ?? null,
    slackTeamId: record?.slackTeamId ?? null,
    status: getSlackIntegrationStatus(record),
    updatedAt: record?.updatedAt?.toISOString() ?? null,
    version: record?.version ?? 0,
  }
}

export function isSlackBotToken(value: string): boolean {
  return value.startsWith('xoxb-')
}

export function isSlackAppToken(value: string): boolean {
  return value.startsWith('xapp-')
}

export async function testSlackCredentials(args: {
  appToken: string
  botToken: string
}): Promise<SlackIntegrationTestResponse> {
  const botAuth = await callSlackApi('auth.test', args.botToken)
  const botId = botAuth.bot_id
  if (!botId) {
    throw new Error('slack_bot_id_missing')
  }

  const botInfo = await callSlackApi(
    'bots.info',
    args.botToken,
    new URLSearchParams({ bot: botId }).toString(),
  )
  const socket = await callSlackApi('apps.connections.open', args.appToken)
  const socketAppId = extractSlackAppId(socket.url)
  const botAppId = botInfo.bot?.app_id ?? null

  if (socketAppId && botAppId && socketAppId !== botAppId) {
    throw new Error('slack_app_mismatch')
  }

  return {
    appId: socketAppId,
    botUserId: botAuth.user_id ?? null,
    ok: true,
    socketUrlAvailable: typeof socket.url === 'string' && socket.url.length > 0,
    teamId: botAuth.team_id ?? null,
  }
}

function extractSlackAppId(socketUrl: string | undefined): string | null {
  if (!socketUrl) {
    return null
  }

  try {
    const parsed = new URL(socketUrl)
    const appId = parsed.searchParams.get('app_id')
    return appId && appId.trim() ? appId : null
  } catch {
    return null
  }
}

async function callSlackApi(method: string, token: string, body = ''): Promise<SlackApiResponse> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })

  const data = await response.json().catch(() => null) as SlackApiResponse | null
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? `slack_${method.replace(/\./g, '_')}_failed`)
  }

  return data
}

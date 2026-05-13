import { slackService } from '@/lib/services'
import { loadSlackAgentOptions } from '@/lib/slack/agents'
import type {
  SlackActionContext,
  SlackActionTarget,
  SlackBlock,
  SlackChatClient,
  SlackCommandBody,
  SlackEventEnvelope,
  SlackMessageEvent,
  SlackUserProfile,
} from '@/lib/slack/socket-types'

export function buildSlackSessionTitle(channel: string, threadTs: string): string {
  return `Slack | ${channel} | ${threadTs}`
}

export function buildSlackDmSessionTitle(profile: SlackUserProfile): string {
  const label = profile.displayName ?? profile.email ?? 'unknown Slack user'
  return `Slack DM | ${label} | ${new Date().toISOString()}`
}

export function buildSlackThreadKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`
}

export function getEventId(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  return typeof (body as SlackEventEnvelope).event_id === 'string'
    ? (body as SlackEventEnvelope).event_id ?? null
    : null
}

export async function resolveSlackTeamId(body: unknown): Promise<string | null> {
  const bodyTeamId = getSlackTeamId(body)
  if (bodyTeamId) {
    return bodyTeamId
  }

  return (await slackService.findIntegration())?.slackTeamId ?? null
}

function getSlackTeamId(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const record = body as Record<string, unknown>
  if (typeof record.team_id === 'string') {
    return record.team_id
  }

  const team = record.team
  if (team && typeof team === 'object' && typeof (team as Record<string, unknown>).id === 'string') {
    return (team as Record<string, unknown>).id as string
  }

  const authorizations = record.authorizations
  if (Array.isArray(authorizations)) {
    for (const authorization of authorizations) {
      if (!authorization || typeof authorization !== 'object') {
        continue
      }

      const teamId = (authorization as Record<string, unknown>).team_id
      if (typeof teamId === 'string') {
        return teamId
      }
    }
  }

  return null
}

export function getSlackActionValue(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const actions = (body as Record<string, unknown>).actions
  if (!Array.isArray(actions)) {
    return null
  }

  const action = actions[0]
  if (!action || typeof action !== 'object') {
    return null
  }

  const value = (action as Record<string, unknown>).value
  return typeof value === 'string' && value ? value : null
}

export function getSlackActionTarget(body: unknown): SlackActionTarget | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const record = body as Record<string, unknown>
  const channel = record.channel
  const message = record.message
  const channelId = channel && typeof channel === 'object'
    ? (channel as Record<string, unknown>).id
    : null
  const messageTs = message && typeof message === 'object'
    ? (message as Record<string, unknown>).ts
    : null

  if (typeof channelId !== 'string' || typeof messageTs !== 'string') {
    return null
  }

  return { channelId, messageTs }
}

export function getSlackActionContext(body: unknown): SlackActionContext | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const record = body as Record<string, unknown>
  const channel = record.channel
  const team = record.team
  const user = record.user
  const channelId = channel && typeof channel === 'object'
    ? (channel as Record<string, unknown>).id
    : null
  const slackTeamId = team && typeof team === 'object'
    ? (team as Record<string, unknown>).id
    : record.team_id
  const slackUserId = user && typeof user === 'object'
    ? (user as Record<string, unknown>).id
    : record.user_id

  if (
    typeof channelId !== 'string' ||
    typeof slackTeamId !== 'string' ||
    typeof slackUserId !== 'string'
  ) {
    return null
  }

  return { channelId, slackTeamId, slackUserId }
}

export function extractSlackResponseTs(response: unknown): string | null {
  if (!response || typeof response !== 'object') {
    return null
  }

  const ts = (response as Record<string, unknown>).ts
  return typeof ts === 'string' ? ts : null
}

export function mapSlackFailureToMessage(error: string): string {
  if (error === 'autopilot_run_timeout') {
    return 'I took too long to reply in Slack. Please try again.'
  }
  if (error === 'autopilot_no_assistant_message') {
    return 'I could not produce a Slack reply for that message.'
  }
  if (error === 'provider_auth_missing') {
    return 'I cannot answer in Slack yet because this workspace has no provider credentials configured. Add a provider API key in Settings > Providers and try again.'
  }
  if (error === 'session_busy') {
    return 'That conversation is already working on a reply. Wait for it to finish, then send your next message.'
  }

  return 'I hit an error while preparing the Slack reply. Please try again.'
}

export function mapSlackUserResolutionError(error: string): string {
  if (error === 'slack_email_missing') {
    return 'I cannot read your Slack email. Ask an admin to verify the users:read.email scope.'
  }

  if (error === 'slack_email_not_found') {
    return 'I cannot find an Arche account with your Slack email. Check that your email matches or contact an admin.'
  }

  return 'I cannot find an Arche account linked to your Slack user.'
}

export function normalizeSlackMessageEvent(event: unknown): SlackMessageEvent | null {
  if (!event || typeof event !== 'object') {
    return null
  }

  const record = event as Record<string, unknown>
  return {
    bot_id: typeof record.bot_id === 'string' ? record.bot_id : undefined,
    channel: typeof record.channel === 'string' ? record.channel : undefined,
    channel_type: typeof record.channel_type === 'string' ? record.channel_type : undefined,
    subtype: typeof record.subtype === 'string' ? record.subtype : undefined,
    text: typeof record.text === 'string' ? record.text : undefined,
    thread_ts: typeof record.thread_ts === 'string' ? record.thread_ts : undefined,
    ts: typeof record.ts === 'string' ? record.ts : undefined,
    user: typeof record.user === 'string' ? record.user : undefined,
  }
}

export function normalizeSlackCommandBody(body: unknown): SlackCommandBody | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const record = body as Record<string, unknown>
  return {
    channel_id: typeof record.channel_id === 'string' ? record.channel_id : undefined,
    channel_name: typeof record.channel_name === 'string' ? record.channel_name : undefined,
    team_id: typeof record.team_id === 'string' ? record.team_id : undefined,
    text: typeof record.text === 'string' ? record.text : undefined,
    user_id: typeof record.user_id === 'string' ? record.user_id : undefined,
  }
}

export async function loadSlackUserProfile(
  client: SlackChatClient,
  slackUserId: string,
): Promise<SlackUserProfile> {
  try {
    const response = await client.users.info({ user: slackUserId })
    const user = response && typeof response === 'object'
      ? (response as Record<string, unknown>).user
      : null
    if (!user || typeof user !== 'object') {
      return { displayName: null, email: null }
    }

    const userRecord = user as Record<string, unknown>
    const profile = userRecord.profile && typeof userRecord.profile === 'object'
      ? userRecord.profile as Record<string, unknown>
      : null
    const displayName = firstNonEmptyString([
      profile?.display_name,
      profile?.real_name,
      userRecord.real_name,
      userRecord.name,
    ])
    const email = firstNonEmptyString([profile?.email])

    return { displayName, email }
  } catch {
    return { displayName: null, email: null }
  }
}

function firstNonEmptyString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }

    const trimmed = value.trim()
    if (trimmed) {
      return trimmed
    }
  }

  return null
}

export async function finalizeSlackReply(
  client: SlackChatClient,
  channel: string,
  threadTs: string,
  placeholderTs: string | null,
  text: string,
): Promise<void> {
  if (placeholderTs) {
    await client.chat.update({
      channel,
      text,
      ts: placeholderTs,
    })
    return
  }

  await client.chat.postMessage({
    channel,
    text,
    thread_ts: threadTs,
  })
}

export async function postSlackDmPlaceholder(
  client: SlackChatClient,
  channel: string,
): Promise<string | null> {
  try {
    const response = await client.chat.postMessage({
      channel,
      text: 'Thinking...',
    })

    return extractSlackResponseTs(response)
  } catch {
    return null
  }
}

export async function finalizeSlackDmReply(
  client: SlackChatClient,
  channel: string,
  placeholderTs: string | null,
  text: string,
): Promise<void> {
  if (placeholderTs) {
    await client.chat.update({
      channel,
      text,
      ts: placeholderTs,
    })
    return
  }

  await postSlackDmMessage(client, channel, text)
}

export function postSlackDmMessage(
  client: SlackChatClient,
  channel: string,
  text: string,
): Promise<unknown> {
  return client.chat.postMessage({
    channel,
    text,
  })
}

export async function updateSlackActionMessage(
  client: SlackChatClient,
  target: SlackActionTarget | null,
  text: string,
): Promise<void> {
  if (!target) {
    return
  }

  await client.chat.update({
    blocks: [],
    channel: target.channelId,
    text,
    ts: target.messageTs,
  })
}

export async function postSlackPlaceholder(
  client: SlackChatClient,
  channel: string,
  threadTs: string,
): Promise<string | null> {
  try {
    const response = await client.chat.postMessage({
      channel,
      text: 'Thinking...',
      thread_ts: threadTs,
    })

    const ts = (response as { ts?: unknown }).ts
    return typeof ts === 'string' ? ts : null
  } catch {
    return null
  }
}

export async function resolveTargetAgentId(defaultAgentId: string | null): Promise<string | null> {
  const options = await loadSlackAgentOptions()
  if (!options.ok) {
    return defaultAgentId
  }

  if (defaultAgentId && options.agents.some((agent) => agent.id === defaultAgentId)) {
    return defaultAgentId
  }

  return options.primaryAgentId
}

export async function resolveConfiguredSlackAgentId(): Promise<string | null> {
  const integration = await slackService.findIntegration()
  return resolveTargetAgentId(integration?.defaultAgentId ?? null)
}

export function isSlackDmMessage(event: SlackMessageEvent): boolean {
  return event.channel_type === 'im' || event.channel?.startsWith('D') === true
}

export function isSlackDmCommand(body: SlackCommandBody): boolean {
  return body.channel_name === 'directmessage' || body.channel_id?.startsWith('D') === true
}

export function shouldIgnoreSlackMessage(event: SlackMessageEvent, savedBotUserId: string | null): boolean {
  if (event.subtype) {
    return true
  }
  if (event.bot_id) {
    return true
  }
  if (savedBotUserId && event.user === savedBotUserId) {
    return true
  }

  return false
}

export function stripBotMention(text: string, botUserId: string | null): string {
  if (!botUserId) {
    return text.trim()
  }

  return text.replaceAll(`<@${botUserId}>`, '').trim()
}

export function buildSlackDmDecisionBlocks(decisionId: string): SlackBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'More than 2 hours have passed since the last conversation.\nDo you want to continue the previous conversation or start a new one?',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: 'continue_conversation',
          text: { type: 'plain_text', text: 'Continue' },
          value: decisionId,
        },
        {
          type: 'button',
          action_id: 'start_new_conversation',
          style: 'primary',
          text: { type: 'plain_text', text: 'Start new' },
          value: decisionId,
        },
      ],
    },
  ]
}

import { App, LogLevel } from '@slack/bolt'

import { createInstanceClient } from '@/lib/opencode/client'
import {
  captureSessionMessageCursor,
  ensureWorkspaceRunningForExecution,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/opencode/session-execution'
import { loadSlackAgentOptions } from '@/lib/slack/agents'
import { buildSlackContext } from '@/lib/slack/context'
import { decryptSlackToken } from '@/lib/slack/crypto'
import { buildSlackPrompt } from '@/lib/slack/prompt'
import { ensureSlackServiceUser } from '@/lib/slack/service-user'
import { slackService } from '@/lib/services'

const SLACK_MANAGER_SYNC_INTERVAL_MS = 30_000

type SlackEventEnvelope = {
  event_id?: string
}

type SlackMessageEvent = {
  bot_id?: string
  channel?: string
  subtype?: string
  text?: string
  thread_ts?: string
  ts?: string
  user?: string
}

type SlackChatClient = {
  chat: {
    postMessage: (args: { channel: string; text: string; thread_ts?: string }) => Promise<unknown>
    update: (args: { channel: string; text: string; ts: string }) => Promise<unknown>
  }
  conversations: {
    history: (args: { channel: string; inclusive: boolean; latest: string; limit: number }) => Promise<unknown>
    replies: (args: { channel: string; limit: number; ts: string }) => Promise<unknown>
  }
  users: {
    info: (args: { user: string }) => Promise<unknown>
  }
}

type ManagedSlackApp = {
  app: App
  version: number
}

let currentApp: ManagedSlackApp | null = null
let syncInterval: NodeJS.Timeout | null = null
let syncPromise: Promise<void> | null = null
const eventExecutionLocks = new Map<string, Promise<void>>()
const threadExecutionLocks = new Map<string, Promise<void>>()

export function startSlackSocketManager(): void {
  if (syncInterval) {
    return
  }

  syncInterval = setInterval(() => {
    void syncSlackSocketManager().catch((error) => {
      console.error('[slack] Failed to sync socket manager', error)
    })
  }, SLACK_MANAGER_SYNC_INTERVAL_MS)

  void syncSlackSocketManager().catch((error) => {
    console.error('[slack] Failed to start socket manager', error)
  })
}

export function stopSlackSocketManager(): void {
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
  }

  if (!currentApp) {
    return
  }

  void currentApp.app.stop().catch((error) => {
    console.error('[slack] Failed to stop socket app', error)
  })
  currentApp = null
}

export async function syncSlackSocketManager(forceReconnect = false): Promise<void> {
  if (syncPromise) {
    return syncPromise
  }

  syncPromise = performSlackSocketSync(forceReconnect).finally(() => {
    syncPromise = null
  })

  return syncPromise
}

async function performSlackSocketSync(forceReconnect: boolean): Promise<void> {
  const integration = await slackService.findIntegration()
  if (!integration?.enabled || !integration.botTokenSecret || !integration.appTokenSecret) {
    await teardownCurrentApp()
    return
  }

  if (!forceReconnect && currentApp?.version === integration.version) {
    return
  }

  let nextApp: App | null = null

  try {
    await teardownCurrentApp()

    const botToken = decryptSlackToken(integration.botTokenSecret)
    const appToken = decryptSlackToken(integration.appTokenSecret)
    nextApp = createSlackApp({
      appToken,
      botToken,
      botUserId: integration.slackBotUserId,
    })

    await nextApp.start()
    currentApp = {
      app: nextApp,
      version: integration.version,
    }
    await slackService.markSocketConnected(new Date())
    await slackService.markLastError(null)
  } catch (error) {
    await nextApp?.stop().catch(() => undefined)
    await slackService.markLastError(toErrorMessage(error)).catch(() => undefined)
    throw error
  }
}

function createSlackApp(args: {
  appToken: string
  botToken: string
  botUserId: string | null
}): App {
  const app = new App({
    appToken: args.appToken,
    logLevel: LogLevel.WARN,
    socketMode: true,
    token: args.botToken,
  })

  app.event('app_mention', async ({ body, client, event }) => {
    await handleSlackEvent({
      body,
      client: client as unknown as SlackChatClient,
      event: normalizeSlackMessageEvent(event),
      isMention: true,
      savedBotUserId: args.botUserId,
      type: 'app_mention',
    })
  })

  app.event('message', async ({ body, client, event }) => {
    await handleSlackEvent({
      body,
      client: client as unknown as SlackChatClient,
      event: normalizeSlackMessageEvent(event),
      isMention: false,
      savedBotUserId: args.botUserId,
      type: 'message',
    })
  })

  app.error(async (error) => {
    const detail = toErrorMessage(error)
    console.error('[slack] Socket app error', detail)
    await slackService.markLastError(detail).catch(() => undefined)
  })

  return app
}

async function handleSlackEvent(args: {
  body: unknown
  client: SlackChatClient
  event: SlackMessageEvent | null
  isMention: boolean
  savedBotUserId: string | null
  type: string
}): Promise<void> {
  const eventId = getEventId(args.body)
  if (!eventId || !args.event?.channel || !args.event.ts) {
    return
  }

  if (await slackService.hasEventReceipt(eventId)) {
    return
  }

  await withSlackEventLock(eventId, async () => {
    if (await slackService.hasEventReceipt(eventId)) {
      return
    }

    const event = args.event
    if (!event || !event.channel || !event.ts) {
      return
    }

    const channel = event.channel
    const eventTs = event.ts

    if (shouldIgnoreSlackMessage(event, args.savedBotUserId)) {
      return
    }

    const threadTs = event.thread_ts ?? eventTs
    await withSlackThreadLock(buildSlackThreadKey(channel, threadTs), async () => {
      const existingBinding = await slackService.findThreadBinding(channel, threadTs)
      if (!args.isMention && (!event.thread_ts || event.thread_ts === eventTs || !existingBinding)) {
        return
      }

      let placeholderTs: string | null = null

      try {
        const serviceUser = await ensureSlackServiceUser()
        if (!serviceUser.ok) {
          throw new Error(serviceUser.error)
        }

        await ensureWorkspaceRunningForExecution(serviceUser.user.slug, serviceUser.user.id)

        const opencodeClient = await createInstanceClient(serviceUser.user.slug)
        if (!opencodeClient) {
          throw new Error('instance_unavailable')
        }

        let sessionId = existingBinding?.openCodeSessionId ?? null
        if (!sessionId) {
          const sessionResult = await opencodeClient.session.create(
            { title: buildSlackSessionTitle(channel, threadTs) },
            { throwOnError: true },
          )
          if (!sessionResult.data) {
            throw new Error('slack_session_create_failed')
          }

          sessionId = sessionResult.data.id
          await slackService.upsertThreadBinding({
            channelId: channel,
            executionUserId: serviceUser.user.id,
            openCodeSessionId: sessionId,
            threadTs,
          })
        }

        const agentId = await resolveTargetAgentId((await slackService.findIntegration())?.defaultAgentId ?? null)
        const context = await buildSlackContext(args.client, {
          channel,
          text: stripBotMention(event.text ?? '', args.savedBotUserId),
          threadTs: event.thread_ts ?? null,
          ts: eventTs,
          user: event.user ?? null,
        })
        const prompt = buildSlackPrompt(context)

        placeholderTs = await postSlackPlaceholder(args.client, channel, threadTs)
        const sessionCursor = await captureSessionMessageCursor(opencodeClient, sessionId)

        await opencodeClient.session.promptAsync(
          {
            agent: agentId ?? undefined,
            parts: [{ type: 'text', text: prompt }],
            sessionID: sessionId,
          },
          { throwOnError: true },
        )

        const failure = await waitForSessionToComplete({
          client: opencodeClient,
          cursor: sessionCursor,
          sessionId,
          slug: serviceUser.user.slug,
        })
        const replyText = failure
          ? mapSlackFailureToMessage(failure)
          : (await readLatestAssistantText(opencodeClient, sessionId, sessionCursor)) ?? 'I could not produce a Slack-ready text response.'

        await finalizeSlackReply(args.client, channel, threadTs, placeholderTs, replyText)
        await slackService.markLastError(null).catch(() => undefined)
      } catch (error) {
        const detail = toErrorMessage(error)
        await finalizeSlackReply(
          args.client,
          channel,
          threadTs,
          placeholderTs,
          'I hit an error while preparing the Slack reply. Please try again.',
        ).catch(() => undefined)
        await slackService.markLastError(detail).catch(() => undefined)
        throw error
      }
    })

    const recorded = await slackService.recordEventReceipt({
      eventId,
      receivedAt: new Date(),
      type: args.type,
    })
    if (recorded) {
      await slackService.markEventReceived(new Date()).catch(() => undefined)
    }
  }).catch(() => undefined)
}

async function finalizeSlackReply(
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

function buildSlackSessionTitle(channel: string, threadTs: string): string {
  return `Slack | ${channel} | ${threadTs}`
}

function buildSlackThreadKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`
}

function getEventId(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  return typeof (body as SlackEventEnvelope).event_id === 'string'
    ? (body as SlackEventEnvelope).event_id ?? null
    : null
}

function mapSlackFailureToMessage(error: string): string {
  if (error === 'autopilot_run_timeout') {
    return 'I took too long to reply in Slack. Please try again.'
  }
  if (error === 'autopilot_no_assistant_message') {
    return 'I could not produce a Slack reply for that message.'
  }

  return 'I hit an error while preparing the Slack reply. Please try again.'
}

function normalizeSlackMessageEvent(event: unknown): SlackMessageEvent | null {
  if (!event || typeof event !== 'object') {
    return null
  }

  const record = event as Record<string, unknown>
  return {
    bot_id: typeof record.bot_id === 'string' ? record.bot_id : undefined,
    channel: typeof record.channel === 'string' ? record.channel : undefined,
    subtype: typeof record.subtype === 'string' ? record.subtype : undefined,
    text: typeof record.text === 'string' ? record.text : undefined,
    thread_ts: typeof record.thread_ts === 'string' ? record.thread_ts : undefined,
    ts: typeof record.ts === 'string' ? record.ts : undefined,
    user: typeof record.user === 'string' ? record.user : undefined,
  }
}

async function postSlackPlaceholder(
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

async function resolveTargetAgentId(defaultAgentId: string | null): Promise<string | null> {
  const options = await loadSlackAgentOptions()
  if (!options.ok) {
    return defaultAgentId
  }

  if (defaultAgentId && options.agents.some((agent) => agent.id === defaultAgentId)) {
    return defaultAgentId
  }

  return options.primaryAgentId
}

function shouldIgnoreSlackMessage(event: SlackMessageEvent, savedBotUserId: string | null): boolean {
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

function stripBotMention(text: string, botUserId: string | null): string {
  if (!botUserId) {
    return text.trim()
  }

  return text.replaceAll(`<@${botUserId}>`, '').trim()
}

async function withSlackThreadLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  return withLock(threadExecutionLocks, key, work)
}

async function withSlackEventLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  return withLock(eventExecutionLocks, key, work)
}

async function withLock<T>(locks: Map<string, Promise<void>>, key: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let releaseCurrent!: () => void
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })

  locks.set(key, current)
  await previous.catch(() => undefined)

  try {
    return await work()
  } finally {
    releaseCurrent()

    if (locks.get(key) === current) {
      locks.delete(key)
    }
  }
}

async function teardownCurrentApp(): Promise<void> {
  if (!currentApp) {
    return
  }

  const appToStop = currentApp.app
  currentApp = null
  await appToStop.stop().catch((error) => {
    console.error('[slack] Failed to stop current socket app', error)
  })
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'slack_error'
}

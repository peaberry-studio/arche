import { App, LogLevel } from '@slack/bolt'

import { slackService } from '@/lib/services'
import {
  handleNewSlackDmCommand,
  handleSlackDmDecisionAction,
  handleSlackDmEvent,
} from '@/lib/slack/dm-handler'
import { withSlackEventLock } from '@/lib/slack/socket-locks'
import type {
  SlackChatClient,
  SlackCommandRespond,
  SlackMessageEvent,
} from '@/lib/slack/socket-types'
import {
  getEventId,
  isSlackDmMessage,
  loadSlackUserProfile,
  mapSlackUserResolutionError,
  normalizeSlackCommandBody,
  normalizeSlackMessageEvent,
  resolveSlackTeamId,
  shouldIgnoreSlackMessage,
} from '@/lib/slack/socket-utils'
import { handleSlackThreadEvent } from '@/lib/slack/thread-handler'

const SLACK_MANAGER_SYNC_INTERVAL_MS = 30_000
const SLACK_EVENT_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const SLACK_EVENT_RECEIPT_PRUNE_INTERVAL_MS = 60 * 60 * 1000

type ManagedSlackApp = {
  app: App
  version: number
}

let currentApp: ManagedSlackApp | null = null
let needsResync = false
let syncInterval: NodeJS.Timeout | null = null
let syncPromise: Promise<void> | null = null
let lastEventReceiptPrunedAt = 0
let managerGeneration = 0

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
  managerGeneration += 1

  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
  }

  if (!currentApp) {
    needsResync = false
    lastEventReceiptPrunedAt = 0
    return
  }

  void currentApp.app.stop().catch((error) => {
    console.error('[slack] Failed to stop socket app', error)
  })
  currentApp = null
  needsResync = false
  lastEventReceiptPrunedAt = 0
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
  const syncGeneration = managerGeneration
  const integration = await slackService.findIntegration()
  if (!integration?.enabled || !integration.botTokenSecret || !integration.appTokenSecret) {
    await teardownCurrentApp()
    return
  }

  if (!forceReconnect && !needsResync && currentApp?.version === integration.version) {
    return
  }

  let nextApp: App | null = null

  try {
    await teardownCurrentApp()

    nextApp = createSlackApp({
      appToken: integration.appTokenSecret,
      botToken: integration.botTokenSecret,
      botUserId: integration.slackBotUserId,
    })

    await nextApp.start()
    if (syncGeneration !== managerGeneration) {
      await nextApp.stop().catch(() => undefined)
      return
    }

    currentApp = {
      app: nextApp,
      version: integration.version,
    }
    needsResync = false
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

  app.command('/new', async ({ ack, body, client, respond }) => {
    await ack()
    await handleNewSlackDmCommand({
      body: normalizeSlackCommandBody(body),
      client: client as unknown as SlackChatClient,
      respond: respond as SlackCommandRespond,
    })
  })

  app.action('continue_conversation', async ({ ack, body, client }) => {
    await ack()
    await handleSlackDmDecisionAction({
      action: 'continue',
      body,
      client: client as unknown as SlackChatClient,
    })
  })

  app.action('start_new_conversation', async ({ ack, body, client }) => {
    await ack()
    await handleSlackDmDecisionAction({
      action: 'start_new',
      body,
      client: client as unknown as SlackChatClient,
    })
  })

  app.error(async (error) => {
    const detail = toErrorMessage(error)
    needsResync = true
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

    if (isSlackDmMessage(event)) {
      await handleSlackDmEvent({
        body: args.body,
        client: args.client,
        event,
        eventId,
      })

      await recordSlackEventReceipt(eventId, 'message.im')
      return
    }

    const authorization = await authorizeSlackThreadEvent({
      body: args.body,
      channel,
      client: args.client,
      event,
    })
    if (!authorization.ok) {
      await args.client.chat.postMessage({
        channel,
        text: authorization.message,
        thread_ts: threadTs,
      }).catch(() => undefined)
      await recordSlackEventReceipt(eventId, args.type)
      return
    }

    await handleSlackThreadEvent({
      channel,
      client: args.client,
      event,
      eventTs,
      isMention: args.isMention,
      savedBotUserId: args.savedBotUserId,
      threadTs,
    })

    await recordSlackEventReceipt(eventId, args.type)
  }).catch((error) => {
    console.error('[slack] Failed to handle event', {
      error,
      eventId,
      type: args.type,
    })
  })
}

async function authorizeSlackThreadEvent(args: {
  body: unknown
  channel: string
  client: SlackChatClient
  event: SlackMessageEvent
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const slackTeamId = await resolveSlackTeamId(args.body)
  if (!slackTeamId || !args.event.user) {
    return {
      ok: false,
      message: 'I could not identify the Slack workspace or user for this request.',
    }
  }

  const channelAllowed = await slackService.isNotificationChannelAllowed(slackTeamId, args.channel)
  if (!channelAllowed) {
    return {
      ok: false,
      message: 'This Slack channel is not enabled for Arche replies. Ask an admin to allow it in Slack settings.',
    }
  }

  const profile = await loadSlackUserProfile(args.client, args.event.user)
  const resolution = await slackService.resolveArcheUserFromSlackUser(
    slackTeamId,
    args.event.user,
    profile.email,
    profile.displayName,
  )
  if (!resolution.ok) {
    return { ok: false, message: mapSlackUserResolutionError(resolution.error) }
  }

  return { ok: true }
}

async function recordSlackEventReceipt(eventId: string, type: string): Promise<void> {
  const recorded = await slackService.recordEventReceipt({
    eventId,
    receivedAt: new Date(),
    type,
  })
  if (recorded) {
    await maybePruneSlackEventReceipts()
    await slackService.markEventReceived(new Date()).catch(() => undefined)
  }
}

async function maybePruneSlackEventReceipts(): Promise<void> {
  const now = Date.now()
  if (now - lastEventReceiptPrunedAt < SLACK_EVENT_RECEIPT_PRUNE_INTERVAL_MS) {
    return
  }

  lastEventReceiptPrunedAt = now
  try {
    await slackService.pruneEventReceipts(new Date(now - SLACK_EVENT_RECEIPT_RETENTION_MS))
  } catch {
    lastEventReceiptPrunedAt = 0
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

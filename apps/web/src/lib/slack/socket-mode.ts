import { App, LogLevel } from '@slack/bolt'

import { createInstanceClient } from '@/lib/opencode/client'
import {
  captureSessionMessageCursor,
  ensureWorkspaceRunningForExecution,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/opencode/session-execution'
import { auditService, slackService, userService } from '@/lib/services'
import type { SlackPendingDmDecisionRecord } from '@/lib/services/slack'
import { loadSlackAgentOptions } from '@/lib/slack/agents'
import { buildSlackContext } from '@/lib/slack/context'
import { buildSlackDmPrompt } from '@/lib/slack/dm-prompt'
import { buildSlackPrompt } from '@/lib/slack/prompt'
import { ensureSlackServiceUser } from '@/lib/slack/service-user'

const SLACK_MANAGER_SYNC_INTERVAL_MS = 30_000
const SLACK_EVENT_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const SLACK_EVENT_RECEIPT_PRUNE_INTERVAL_MS = 60 * 60 * 1000
const DM_CONTINUE_THRESHOLD_MS = 2 * 60 * 60 * 1000
const DM_NEW_SESSION_THRESHOLD_MS = 8 * 60 * 60 * 1000
const PENDING_DECISION_EXPIRY_MS = 30 * 60 * 1000

type SlackBlock = Record<string, unknown>

type SlackEventEnvelope = {
  event_id?: string
}

type SlackMessageEvent = {
  bot_id?: string
  channel?: string
  channel_type?: string
  subtype?: string
  text?: string
  thread_ts?: string
  ts?: string
  user?: string
}

type SlackChatClient = {
  chat: {
    postMessage: (args: { blocks?: SlackBlock[]; channel: string; text: string; thread_ts?: string }) => Promise<unknown>
    update: (args: { blocks?: SlackBlock[]; channel: string; text: string; ts: string }) => Promise<unknown>
  }
  conversations: {
    history: (args: { channel: string; inclusive: boolean; latest: string; limit: number }) => Promise<unknown>
    replies: (args: { channel: string; limit: number; ts: string }) => Promise<unknown>
  }
  users: {
    info: (args: { user: string }) => Promise<unknown>
  }
}

type SlackCommandBody = {
  channel_id?: string
  channel_name?: string
  team_id?: string
  text?: string
  user_id?: string
}

type SlackCommandRespond = (args: { response_type?: 'ephemeral' | 'in_channel'; text: string }) => Promise<unknown>

type SlackActionTarget = {
  channelId: string
  messageTs: string
}

type SlackUserProfile = {
  displayName: string | null
  email: string | null
}

type PendingSlackDmDecision = SlackPendingDmDecisionRecord & { status: 'pending' }

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

    const botToken = integration.botTokenSecret
    const appToken = integration.appTokenSecret
    nextApp = createSlackApp({
      appToken,
      botToken,
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

    if (isSlackDmMessage(event)) {
      await handleSlackDmEvent({
        body: args.body,
        client: args.client,
        event,
        eventId,
      })

      const recorded = await slackService.recordEventReceipt({
        eventId,
        receivedAt: new Date(),
        type: 'message.im',
      })
      if (recorded) {
        await maybePruneSlackEventReceipts()
        await slackService.markEventReceived(new Date()).catch(() => undefined)
      }
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
      await maybePruneSlackEventReceipts()
      await slackService.markEventReceived(new Date()).catch(() => undefined)
    }
  }).catch((error) => {
    console.error('[slack] Failed to handle event', {
      error,
      eventId,
      type: args.type,
    })
  })
}

async function handleSlackDmEvent(args: {
  body: unknown
  client: SlackChatClient
  event: SlackMessageEvent
  eventId: string
}): Promise<void> {
  const channel = args.event.channel
  const slackUserId = args.event.user
  const text = args.event.text?.trim() ?? ''
  if (!channel || !slackUserId || !text) {
    return
  }

  try {
    const slackTeamId = await resolveSlackTeamId(args.body)
    if (!slackTeamId) {
      await postSlackDmMessage(args.client, channel, 'No pude identificar el workspace de Slack para vincular tu cuenta.')
      return
    }

    const profile = await loadSlackUserProfile(args.client, slackUserId)
    const resolution = await slackService.resolveArcheUserFromSlackUser(
      slackTeamId,
      slackUserId,
      profile.email,
      profile.displayName,
    )
    if (!resolution.ok) {
      await postSlackDmMessage(args.client, channel, mapSlackUserResolutionError(resolution.error))
      return
    }

    const latestSession = await slackService.findLatestDmSession(slackTeamId, slackUserId)
    const now = new Date()
    if (!latestSession) {
      await startNewSlackDmConversation({
        channel,
        client: args.client,
        messageText: text,
        profile,
        slackTeamId,
        slackUserId,
        user: resolution.user,
      })
      return
    }

    const elapsedMs = now.getTime() - latestSession.lastMessageAt.getTime()
    if (elapsedMs < DM_CONTINUE_THRESHOLD_MS) {
      await continueSlackDmConversation({
        binding: latestSession,
        channel,
        client: args.client,
        messageText: text,
        user: resolution.user,
      })
      return
    }

    if (elapsedMs < DM_NEW_SESSION_THRESHOLD_MS) {
      await promptForSlackDmDecision({
        channel,
        client: args.client,
        eventId: args.eventId,
        eventTs: args.event.ts ?? '',
        messageText: text,
        previousBindingId: latestSession.id,
        slackTeamId,
        slackUserId,
      })
      return
    }

    await startNewSlackDmConversation({
      channel,
      client: args.client,
      messagePrefix: 'Han pasado más de 8 horas, así que he empezado una nueva conversación.',
      messageText: text,
      profile,
      slackTeamId,
      slackUserId,
      user: resolution.user,
    })
  } catch (error) {
    const detail = toErrorMessage(error)
    await postSlackDmMessage(args.client, channel, 'I hit an error while preparing the Slack reply. Please try again.').catch(() => undefined)
    await slackService.markLastError(detail).catch(() => undefined)
    throw error
  }
}

async function handleNewSlackDmCommand(args: {
  body: SlackCommandBody | null
  client: SlackChatClient
  respond: SlackCommandRespond
}): Promise<void> {
  const body = args.body
  if (!body?.channel_id || !body.user_id) {
    await args.respond({ text: 'No pude interpretar el comando /new.' })
    return
  }

  if (!isSlackDmCommand(body)) {
    await args.respond({
      response_type: 'ephemeral',
      text: '/new está pensado para DMs con Arche. Para canales, menciona a Arche en un hilo.',
    })
    return
  }

  try {
    const slackTeamId = await resolveSlackTeamId(body)
    if (!slackTeamId) {
      await args.respond({ text: 'No pude identificar el workspace de Slack para vincular tu cuenta.' })
      return
    }

    const profile = await loadSlackUserProfile(args.client, body.user_id)
    const resolution = await slackService.resolveArcheUserFromSlackUser(
      slackTeamId,
      body.user_id,
      profile.email,
      profile.displayName,
    )
    if (!resolution.ok) {
      await args.respond({ text: mapSlackUserResolutionError(resolution.error) })
      return
    }

    const messageText = body.text?.trim() ?? ''
    const session = await createSlackDmSession({
      channelId: body.channel_id,
      profile,
      slackTeamId,
      slackUserId: body.user_id,
      user: resolution.user,
    })

    await auditService.createEvent({
      actorUserId: resolution.user.id,
      action: 'slack.new_command_used',
      metadata: {
        channelId: body.channel_id,
        hasInitialMessage: Boolean(messageText),
        openCodeSessionId: session.sessionId,
        slackTeamId,
        slackUserId: body.user_id,
      },
    })

    if (!messageText) {
      await args.respond({ text: 'Nueva conversación iniciada. Escribe tu siguiente mensaje aquí.' })
      return
    }

    await args.respond({ text: 'Nueva conversación iniciada. Estoy pensando...' })
    await executeSlackDmPromptAndReply({
      bindingId: session.binding.id,
      channel: body.channel_id,
      client: args.client,
      messageText,
      opencodeClient: session.opencodeClient,
      sessionId: session.sessionId,
      slug: resolution.user.slug,
    })
  } catch (error) {
    const detail = toErrorMessage(error)
    await slackService.markLastError(detail).catch(() => undefined)
    await args.respond({ text: 'I hit an error while preparing the Slack reply. Please try again.' }).catch(() => undefined)
  }
}

async function handleSlackDmDecisionAction(args: {
  action: 'continue' | 'start_new'
  body: unknown
  client: SlackChatClient
}): Promise<void> {
  const decisionId = getSlackActionValue(args.body)
  const actionTarget = getSlackActionTarget(args.body)
  if (!decisionId) {
    await updateSlackActionMessage(args.client, actionTarget, 'Esta decisión ya no es válida.').catch(() => undefined)
    return
  }

  try {
    const decision = await slackService.findPendingDmDecision(decisionId)
    if (!decision || decision.status !== 'pending') {
      await updateSlackActionMessage(args.client, actionTarget, 'Esta decisión ya no es válida.')
      return
    }

    if (decision.expiresAt.getTime() <= Date.now()) {
      await slackService.expirePendingDmDecision(decision.id)
      await updateSlackActionMessage(args.client, actionTarget, 'Esta decisión expiró. Envía tu mensaje otra vez para continuar.')
      return
    }

    const pendingDecision: PendingSlackDmDecision = { ...decision, status: 'pending' }

    if (args.action === 'continue') {
      await continueSlackDmDecision(args.client, actionTarget, pendingDecision)
      return
    }

    await startNewSlackDmDecision(args.client, actionTarget, pendingDecision)
  } catch (error) {
    const detail = toErrorMessage(error)
    await slackService.markLastError(detail).catch(() => undefined)
    await updateSlackActionMessage(args.client, actionTarget, 'I hit an error while preparing the Slack reply. Please try again.').catch(() => undefined)
  }
}

async function continueSlackDmDecision(
  client: SlackChatClient,
  actionTarget: SlackActionTarget | null,
  decision: PendingSlackDmDecision,
): Promise<void> {
  if (!decision.previousDmSessionBindingId) {
    await slackService.expirePendingDmDecision(decision.id)
    await updateSlackActionMessage(client, actionTarget, 'No pude encontrar la conversación anterior. Envía tu mensaje otra vez para empezar de nuevo.')
    return
  }

  const binding = await slackService.findDmSessionBindingById(decision.previousDmSessionBindingId)
  if (!binding) {
    await slackService.expirePendingDmDecision(decision.id)
    await updateSlackActionMessage(client, actionTarget, 'No pude encontrar la conversación anterior. Envía tu mensaje otra vez para empezar de nuevo.')
    return
  }

  const claimed = await slackService.markPendingDmDecisionContinued(decision.id)
  if (!claimed) {
    await updateSlackActionMessage(client, actionTarget, 'Esta decisión ya no es válida.')
    return
  }

  const owner = await userService.findByIdSelect(binding.executionUserId, { slug: true })
  if (!owner) {
    await updateSlackActionMessage(client, actionTarget, 'No pude encontrar la cuenta de Arche vinculada.')
    return
  }

  await ensureWorkspaceRunningForExecution(owner.slug, binding.executionUserId)
  const opencodeClient = await createInstanceClient(owner.slug)
  if (!opencodeClient) {
    throw new Error('instance_unavailable')
  }

  await updateSlackActionMessage(client, actionTarget, 'Continuando la conversación anterior...')
  await executeSlackDmPromptAndReply({
    bindingId: binding.id,
    channel: decision.channelId,
    client,
    messageText: decision.messageText,
    opencodeClient,
    sessionId: binding.openCodeSessionId,
    slug: owner.slug,
  })
}

async function startNewSlackDmDecision(
  client: SlackChatClient,
  actionTarget: SlackActionTarget | null,
  decision: PendingSlackDmDecision,
): Promise<void> {
  const claimed = await slackService.markPendingDmDecisionStartedNew(decision.id, '')
  if (!claimed) {
    await updateSlackActionMessage(client, actionTarget, 'Esta decisión ya no es válida.')
    return
  }

  const resolution = await slackService.resolveArcheUserFromSlackUser(
    decision.slackTeamId,
    decision.slackUserId,
    null,
    null,
  )
  if (!resolution.ok) {
    await updateSlackActionMessage(client, actionTarget, mapSlackUserResolutionError(resolution.error))
    return
  }

  const profile = await loadSlackUserProfile(client, decision.slackUserId)
  const session = await createSlackDmSession({
    channelId: decision.channelId,
    profile,
    slackTeamId: decision.slackTeamId,
    slackUserId: decision.slackUserId,
    user: resolution.user,
  })

  await updateSlackActionMessage(client, actionTarget, 'Empezando nueva conversación...')
  await executeSlackDmPromptAndReply({
    bindingId: session.binding.id,
    channel: decision.channelId,
    client,
    messageText: decision.messageText,
    opencodeClient: session.opencodeClient,
    sessionId: session.sessionId,
    slug: resolution.user.slug,
  })
}

async function startNewSlackDmConversation(args: {
  channel: string
  client: SlackChatClient
  messageText: string
  profile: SlackUserProfile
  slackTeamId: string
  slackUserId: string
  user: { id: string; slug: string }
  messagePrefix?: string
}): Promise<void> {
  const session = await createSlackDmSession({
    channelId: args.channel,
    profile: args.profile,
    slackTeamId: args.slackTeamId,
    slackUserId: args.slackUserId,
    user: args.user,
  })

  await executeSlackDmPromptAndReply({
    bindingId: session.binding.id,
    channel: args.channel,
    client: args.client,
    messagePrefix: args.messagePrefix,
    messageText: args.messageText,
    opencodeClient: session.opencodeClient,
    sessionId: session.sessionId,
    slug: args.user.slug,
  })
}

async function continueSlackDmConversation(args: {
  binding: { id: string; openCodeSessionId: string; executionUserId: string }
  channel: string
  client: SlackChatClient
  messageText: string
  user: { id: string; slug: string }
}): Promise<void> {
  await ensureWorkspaceRunningForExecution(args.user.slug, args.user.id)
  const opencodeClient = await createInstanceClient(args.user.slug)
  if (!opencodeClient) {
    throw new Error('instance_unavailable')
  }

  await executeSlackDmPromptAndReply({
    bindingId: args.binding.id,
    channel: args.channel,
    client: args.client,
    messageText: args.messageText,
    opencodeClient,
    sessionId: args.binding.openCodeSessionId,
    slug: args.user.slug,
  })
}

async function createSlackDmSession(args: {
  channelId: string
  profile: SlackUserProfile
  slackTeamId: string
  slackUserId: string
  user: { id: string; slug: string }
}): Promise<{
  binding: { id: string }
  opencodeClient: NonNullable<Awaited<ReturnType<typeof createInstanceClient>>>
  sessionId: string
}> {
  await ensureWorkspaceRunningForExecution(args.user.slug, args.user.id)
  const opencodeClient = await createInstanceClient(args.user.slug)
  if (!opencodeClient) {
    throw new Error('instance_unavailable')
  }

  const sessionResult = await opencodeClient.session.create(
    { title: buildSlackDmSessionTitle(args.profile) },
    { throwOnError: true },
  )
  if (!sessionResult.data) {
    throw new Error('slack_dm_session_create_failed')
  }

  const binding = await slackService.createDmSessionBinding({
    channelId: args.channelId,
    executionUserId: args.user.id,
    openCodeSessionId: sessionResult.data.id,
    slackTeamId: args.slackTeamId,
    slackUserId: args.slackUserId,
  })

  return {
    binding,
    opencodeClient,
    sessionId: sessionResult.data.id,
  }
}

async function executeSlackDmPromptAndReply(args: {
  bindingId: string
  channel: string
  client: SlackChatClient
  messageText: string
  opencodeClient: NonNullable<Awaited<ReturnType<typeof createInstanceClient>>>
  sessionId: string
  slug: string
  messagePrefix?: string
}): Promise<void> {
  const placeholderTs = await postSlackDmPlaceholder(args.client, args.channel)

  try {
    const replyText = await sendSlackDmPromptToSession({
      messageText: args.messageText,
      opencodeClient: args.opencodeClient,
      sessionId: args.sessionId,
      slug: args.slug,
    })
    const finalText = args.messagePrefix ? `${args.messagePrefix}\n\n${replyText}` : replyText

    await slackService.touchDmSessionBinding(args.bindingId, new Date())
    await finalizeSlackDmReply(args.client, args.channel, placeholderTs, finalText)
    await slackService.markLastError(null).catch(() => undefined)
  } catch (error) {
    await finalizeSlackDmReply(
      args.client,
      args.channel,
      placeholderTs,
      'I hit an error while preparing the Slack reply. Please try again.',
    ).catch(() => undefined)
    throw error
  }
}

async function sendSlackDmPromptToSession(args: {
  messageText: string
  opencodeClient: NonNullable<Awaited<ReturnType<typeof createInstanceClient>>>
  sessionId: string
  slug: string
}): Promise<string> {
  const agentId = await resolveConfiguredSlackAgentId()
  const sessionCursor = await captureSessionMessageCursor(args.opencodeClient, args.sessionId)
  await args.opencodeClient.session.promptAsync(
    {
      agent: agentId ?? undefined,
      parts: [{ type: 'text', text: buildSlackDmPrompt({ text: args.messageText }) }],
      sessionID: args.sessionId,
    },
    { throwOnError: true },
  )

  const failure = await waitForSessionToComplete({
    client: args.opencodeClient,
    cursor: sessionCursor,
    sessionId: args.sessionId,
    slug: args.slug,
  })

  return failure
    ? mapSlackFailureToMessage(failure)
    : (await readLatestAssistantText(args.opencodeClient, args.sessionId, sessionCursor)) ?? 'I could not produce a Slack-ready text response.'
}

async function promptForSlackDmDecision(args: {
  channel: string
  client: SlackChatClient
  eventId: string
  eventTs: string
  messageText: string
  previousBindingId: string
  slackTeamId: string
  slackUserId: string
}): Promise<void> {
  const decision = await slackService.createPendingDmDecision({
    channelId: args.channel,
    expiresAt: new Date(Date.now() + PENDING_DECISION_EXPIRY_MS),
    messageText: args.messageText,
    previousDmSessionBindingId: args.previousBindingId,
    slackTeamId: args.slackTeamId,
    slackUserId: args.slackUserId,
    sourceEventId: args.eventId,
    sourceTs: args.eventTs,
  })

  await args.client.chat.postMessage({
    blocks: buildSlackDmDecisionBlocks(decision.id),
    channel: args.channel,
    text: 'Han pasado más de 2 horas desde la última conversación. ¿Quieres continuar la conversación anterior o empezar una nueva?',
  })
}

function buildSlackDmDecisionBlocks(decisionId: string): SlackBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Han pasado más de 2 horas desde la última conversación.\n¿Quieres continuar la conversación anterior o empezar una nueva?',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: 'continue_conversation',
          text: { type: 'plain_text', text: 'Continuar' },
          value: decisionId,
        },
        {
          type: 'button',
          action_id: 'start_new_conversation',
          style: 'primary',
          text: { type: 'plain_text', text: 'Empezar nueva' },
          value: decisionId,
        },
      ],
    },
  ]
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

async function postSlackDmPlaceholder(
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

async function finalizeSlackDmReply(
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

function postSlackDmMessage(
  client: SlackChatClient,
  channel: string,
  text: string,
): Promise<unknown> {
  return client.chat.postMessage({
    channel,
    text,
  })
}

async function updateSlackActionMessage(
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

function buildSlackSessionTitle(channel: string, threadTs: string): string {
  return `Slack | ${channel} | ${threadTs}`
}

function buildSlackDmSessionTitle(profile: SlackUserProfile): string {
  const label = profile.displayName ?? profile.email ?? 'unknown Slack user'
  return `Slack DM | ${label} | ${new Date().toISOString()}`
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

async function resolveSlackTeamId(body: unknown): Promise<string | null> {
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

function getSlackActionValue(body: unknown): string | null {
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

function getSlackActionTarget(body: unknown): SlackActionTarget | null {
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

function extractSlackResponseTs(response: unknown): string | null {
  if (!response || typeof response !== 'object') {
    return null
  }

  const ts = (response as Record<string, unknown>).ts
  return typeof ts === 'string' ? ts : null
}

function mapSlackFailureToMessage(error: string): string {
  if (error === 'autopilot_run_timeout') {
    return 'I took too long to reply in Slack. Please try again.'
  }
  if (error === 'autopilot_no_assistant_message') {
    return 'I could not produce a Slack reply for that message.'
  }
  if (error === 'provider_auth_missing') {
    return 'I cannot answer in Slack yet because this workspace has no provider credentials configured. Add a provider API key in Settings > Providers and try again.'
  }

  return 'I hit an error while preparing the Slack reply. Please try again.'
}

function mapSlackUserResolutionError(error: string): string {
  if (error === 'slack_email_missing') {
    return 'No puedo leer tu email de Slack. Pide a un admin que revise el scope users:read.email.'
  }

  if (error === 'slack_email_not_found') {
    return 'No encuentro una cuenta de Arche con tu email de Slack. Revisa que tu email coincida o contacta a un admin.'
  }

  return 'No encuentro una cuenta de Arche vinculada a tu usuario de Slack.'
}

function normalizeSlackMessageEvent(event: unknown): SlackMessageEvent | null {
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

function normalizeSlackCommandBody(body: unknown): SlackCommandBody | null {
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

async function loadSlackUserProfile(
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

async function resolveConfiguredSlackAgentId(): Promise<string | null> {
  const integration = await slackService.findIntegration()
  return resolveTargetAgentId(integration?.defaultAgentId ?? null)
}

function isSlackDmMessage(event: SlackMessageEvent): boolean {
  return event.channel_type === 'im' || event.channel?.startsWith('D') === true
}

function isSlackDmCommand(body: SlackCommandBody): boolean {
  return body.channel_name === 'directmessage' || body.channel_id?.startsWith('D') === true
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

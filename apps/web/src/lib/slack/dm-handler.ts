import { createInstanceClient } from '@/lib/opencode/client'
import {
  captureSessionMessageCursor,
  ensureWorkspaceRunningForExecution,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/opencode/session-execution'
import { auditService, slackService, userService } from '@/lib/services'
import type { SlackPendingDmDecisionRecord } from '@/lib/services/slack'
import { buildSlackDmPrompt } from '@/lib/slack/dm-prompt'
import type {
  SlackActionTarget,
  SlackChatClient,
  SlackCommandBody,
  SlackCommandRespond,
  SlackMessageEvent,
  SlackUserProfile,
} from '@/lib/slack/socket-types'
import {
  buildSlackDmDecisionBlocks,
  buildSlackDmSessionTitle,
  finalizeSlackDmReply,
  getSlackActionTarget,
  getSlackActionValue,
  isSlackDmCommand,
  loadSlackUserProfile,
  mapSlackFailureToMessage,
  mapSlackUserResolutionError,
  postSlackDmMessage,
  postSlackDmPlaceholder,
  resolveConfiguredSlackAgentId,
  resolveSlackTeamId,
  updateSlackActionMessage,
} from '@/lib/slack/socket-utils'

const DM_CONTINUE_THRESHOLD_MS = 2 * 60 * 60 * 1000
const DM_NEW_SESSION_THRESHOLD_MS = 8 * 60 * 60 * 1000
const PENDING_DECISION_EXPIRY_MS = 30 * 60 * 1000

type PendingSlackDmDecision = SlackPendingDmDecisionRecord & { status: 'pending' }

export async function handleSlackDmEvent(args: {
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
    const detail = error instanceof Error ? error.message : 'slack_error'
    await postSlackDmMessage(args.client, channel, 'I hit an error while preparing the Slack reply. Please try again.').catch(() => undefined)
    await slackService.markLastError(detail).catch(() => undefined)
    throw error
  }
}

export async function handleNewSlackDmCommand(args: {
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
    const detail = error instanceof Error ? error.message : 'slack_error'
    await slackService.markLastError(detail).catch(() => undefined)
    await args.respond({ text: 'I hit an error while preparing the Slack reply. Please try again.' }).catch(() => undefined)
  }
}

export async function handleSlackDmDecisionAction(args: {
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
    const detail = error instanceof Error ? error.message : 'slack_error'
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

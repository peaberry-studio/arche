import { createInstanceClient } from '@/lib/opencode/client'
import {
  captureSessionMessageCursor,
  ensureWorkspaceRunningForExecution,
  isOpenCodeSessionNotFoundError,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/opencode/session-execution'
import { openCodeSessionExists } from '@/lib/opencode/session-utils'
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
  getSlackActionContext,
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
const STALE_DM_SESSION_MESSAGE = 'The previous Slack conversation was no longer available, so I started a new conversation.'

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
      await postSlackDmMessage(args.client, channel, 'I could not identify the Slack workspace to link your account.')
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
        profile,
        slackTeamId,
        slackUserId,
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
      messagePrefix: 'More than 8 hours have passed, so I started a new conversation.',
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
    // The user was notified above; rethrow so the socket manager logs the failure.
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
    await args.respond({ text: 'I could not interpret the /new command.' })
    return
  }

  if (!isSlackDmCommand(body)) {
    await args.respond({
      response_type: 'ephemeral',
      text: '/new is intended for Arche DMs. For channels, mention Arche in a thread.',
    })
    return
  }

  try {
    const slackTeamId = await resolveSlackTeamId(body)
    if (!slackTeamId) {
      await args.respond({ text: 'I could not identify the Slack workspace to link your account.' })
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
      await args.respond({ text: 'New conversation started. Send your next message here.' })
      return
    }

    await args.respond({ text: 'New conversation started. Thinking...' })
    await executeSlackDmPromptAndReply({
      bindingId: session.binding.id,
      channel: body.channel_id,
      client: args.client,
      messageText,
      opencodeClient: session.opencodeClient,
      sessionId: session.sessionId,
      slug: resolution.user.slug,
      staleSessionRecovery: {
        profile,
        slackTeamId,
        slackUserId: body.user_id,
        user: resolution.user,
      },
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
    await updateSlackActionMessage(args.client, actionTarget, 'This decision is no longer valid.').catch(() => undefined)
    return
  }

  try {
    const decision = await slackService.findPendingDmDecision(decisionId)
    if (!decision || decision.status !== 'pending') {
      await updateSlackActionMessage(args.client, actionTarget, 'This decision is no longer valid.')
      return
    }

    const actionContext = getSlackActionContext(args.body)
    if (
      !actionContext ||
      actionContext.channelId !== decision.channelId ||
      actionContext.slackTeamId !== decision.slackTeamId ||
      actionContext.slackUserId !== decision.slackUserId
    ) {
      await updateSlackActionMessage(args.client, actionTarget, 'This decision is no longer valid.')
      return
    }

    if (decision.expiresAt.getTime() <= Date.now()) {
      await slackService.expirePendingDmDecision(decision.id)
      await updateSlackActionMessage(args.client, actionTarget, 'This decision expired. Send your message again to continue.')
      return
    }

    if (args.action === 'continue') {
      await continueSlackDmDecision(args.client, actionTarget, decision)
      return
    }

    await startNewSlackDmDecision(args.client, actionTarget, decision)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'slack_error'
    await slackService.markLastError(detail).catch(() => undefined)
    await updateSlackActionMessage(args.client, actionTarget, 'I hit an error while preparing the Slack reply. Please try again.').catch(() => undefined)
  }
}

async function continueSlackDmDecision(
  client: SlackChatClient,
  actionTarget: SlackActionTarget | null,
  decision: SlackPendingDmDecisionRecord,
): Promise<void> {
  if (!decision.previousDmSessionBindingId) {
    await slackService.expirePendingDmDecision(decision.id)
    await updateSlackActionMessage(client, actionTarget, 'I could not find the previous conversation. Send your message again to start over.')
    return
  }

  const binding = await slackService.findDmSessionBindingById(decision.previousDmSessionBindingId)
  if (!binding) {
    await slackService.expirePendingDmDecision(decision.id)
    await updateSlackActionMessage(client, actionTarget, 'I could not find the previous conversation. Send your message again to start over.')
    return
  }

  const claimed = await slackService.markPendingDmDecisionContinued(decision.id)
  if (!claimed) {
    await updateSlackActionMessage(client, actionTarget, 'This decision is no longer valid.')
    return
  }

  const owner = await userService.findByIdSelect(binding.executionUserId, { slug: true })
  if (!owner) {
    await updateSlackActionMessage(client, actionTarget, 'I could not find the linked Arche account.')
    return
  }

  const profile = await loadSlackUserProfile(client, decision.slackUserId)
  const session = await prepareSlackDmContinuation({
    binding,
    channel: decision.channelId,
    profile,
    slackTeamId: decision.slackTeamId,
    slackUserId: decision.slackUserId,
    user: { id: binding.executionUserId, slug: owner.slug },
  })

  await updateSlackActionMessage(
    client,
    actionTarget,
    session.messagePrefix ? 'The previous conversation was no longer available. Starting a new one...' : 'Continuing the previous conversation...',
  )
  await executeSlackDmPromptAndReply({
    bindingId: session.bindingId,
    channel: decision.channelId,
    client,
    messageText: decision.messageText,
    messagePrefix: session.messagePrefix,
    opencodeClient: session.opencodeClient,
    sessionId: session.sessionId,
    slug: owner.slug,
    staleSessionRecovery: {
      profile,
      slackTeamId: decision.slackTeamId,
      slackUserId: decision.slackUserId,
      user: { id: binding.executionUserId, slug: owner.slug },
    },
  })
}

async function startNewSlackDmDecision(
  client: SlackChatClient,
  actionTarget: SlackActionTarget | null,
  decision: SlackPendingDmDecisionRecord,
): Promise<void> {
  const claimed = await slackService.markPendingDmDecisionStartedNew(decision.id)
  if (!claimed) {
    await updateSlackActionMessage(client, actionTarget, 'This decision is no longer valid.')
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

  await updateSlackActionMessage(client, actionTarget, 'Starting a new conversation...')
  await executeSlackDmPromptAndReply({
    bindingId: session.binding.id,
    channel: decision.channelId,
    client,
    messageText: decision.messageText,
    opencodeClient: session.opencodeClient,
    sessionId: session.sessionId,
    slug: resolution.user.slug,
    staleSessionRecovery: {
      profile,
      slackTeamId: decision.slackTeamId,
      slackUserId: decision.slackUserId,
      user: resolution.user,
    },
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
    staleSessionRecovery: {
      profile: args.profile,
      slackTeamId: args.slackTeamId,
      slackUserId: args.slackUserId,
      user: args.user,
    },
  })
}

async function continueSlackDmConversation(args: {
  binding: { id: string; openCodeSessionId: string; executionUserId: string }
  channel: string
  client: SlackChatClient
  messageText: string
  profile: SlackUserProfile
  slackTeamId: string
  slackUserId: string
  user: { id: string; slug: string }
}): Promise<void> {
  const session = await prepareSlackDmContinuation({
    binding: args.binding,
    channel: args.channel,
    profile: args.profile,
    slackTeamId: args.slackTeamId,
    slackUserId: args.slackUserId,
    user: args.user,
  })

  await executeSlackDmPromptAndReply({
    bindingId: session.bindingId,
    channel: args.channel,
    client: args.client,
    messagePrefix: session.messagePrefix,
    messageText: args.messageText,
    opencodeClient: session.opencodeClient,
    sessionId: session.sessionId,
    slug: args.user.slug,
    staleSessionRecovery: {
      profile: args.profile,
      slackTeamId: args.slackTeamId,
      slackUserId: args.slackUserId,
      user: args.user,
    },
  })
}

async function prepareSlackDmContinuation(args: {
  binding: { id: string; openCodeSessionId: string; executionUserId: string }
  channel: string
  profile: SlackUserProfile
  slackTeamId: string
  slackUserId: string
  user: { id: string; slug: string }
}): Promise<{
  bindingId: string
  opencodeClient: NonNullable<Awaited<ReturnType<typeof createInstanceClient>>>
  sessionId: string
  messagePrefix?: string
}> {
  await ensureWorkspaceRunningForExecution(args.user.slug, args.user.id)
  const opencodeClient = await createInstanceClient(args.user.slug)
  if (!opencodeClient) {
    throw new Error('instance_unavailable')
  }

  const sessionExists = await openCodeSessionExists(opencodeClient, args.binding.openCodeSessionId)
  if (sessionExists) {
    return {
      bindingId: args.binding.id,
      opencodeClient,
      sessionId: args.binding.openCodeSessionId,
    }
  }

  await slackService.deleteSessionBindingsByOpenCodeSessionId(args.binding.openCodeSessionId).catch((error) => {
    console.warn('[slack] Failed to delete stale DM session bindings', {
      error,
      openCodeSessionId: args.binding.openCodeSessionId,
    })
  })
  const session = await createSlackDmSession({
    channelId: args.channel,
    profile: args.profile,
    slackTeamId: args.slackTeamId,
    slackUserId: args.slackUserId,
    user: args.user,
  })

  return {
    bindingId: session.binding.id,
    messagePrefix: STALE_DM_SESSION_MESSAGE,
    opencodeClient: session.opencodeClient,
    sessionId: session.sessionId,
  }
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
  staleSessionRecovery?: {
    profile: SlackUserProfile
    slackTeamId: string
    slackUserId: string
    user: { id: string; slug: string }
  }
}): Promise<void> {
  const placeholderTs = await postSlackDmPlaceholder(args.client, args.channel)

  try {
    const replyText = await sendSlackDmPromptToSession({
      messageText: args.messageText,
      opencodeClient: args.opencodeClient,
      sessionId: args.sessionId,
      slug: args.slug,
    })
    const finalText = formatSlackReply(replyText, [args.messagePrefix])

    await slackService.touchDmSessionBinding(args.bindingId, new Date())
    await finalizeSlackDmReply(args.client, args.channel, placeholderTs, finalText)
    await slackService.markLastError(null).catch(() => undefined)
  } catch (error) {
    if (args.staleSessionRecovery && isOpenCodeSessionNotFoundError(error)) {
      try {
        const session = await recoverStaleSlackDmSession({
          channelId: args.channel,
          profile: args.staleSessionRecovery.profile,
          slackTeamId: args.staleSessionRecovery.slackTeamId,
          slackUserId: args.staleSessionRecovery.slackUserId,
          staleOpenCodeSessionId: args.sessionId,
          user: args.staleSessionRecovery.user,
        })
        const replyText = await sendSlackDmPromptToSession({
          messageText: args.messageText,
          opencodeClient: session.opencodeClient,
          sessionId: session.sessionId,
          slug: args.slug,
        })
        const finalText = formatSlackReply(replyText, [args.messagePrefix, STALE_DM_SESSION_MESSAGE])

        await slackService.touchDmSessionBinding(session.binding.id, new Date())
        await finalizeSlackDmReply(args.client, args.channel, placeholderTs, finalText)
        await slackService.markLastError(null).catch(() => undefined)
        return
      } catch (retryError) {
        await finalizeSlackDmReply(
          args.client,
          args.channel,
          placeholderTs,
          'I hit an error while preparing the Slack reply. Please try again.',
        ).catch(() => undefined)
        throw retryError
      }
    }

    await finalizeSlackDmReply(
      args.client,
      args.channel,
      placeholderTs,
      'I hit an error while preparing the Slack reply. Please try again.',
    ).catch(() => undefined)
    throw error
  }
}

async function recoverStaleSlackDmSession(args: {
  channelId: string
  profile: SlackUserProfile
  slackTeamId: string
  slackUserId: string
  staleOpenCodeSessionId: string
  user: { id: string; slug: string }
}): ReturnType<typeof createSlackDmSession> {
  await slackService.deleteSessionBindingsByOpenCodeSessionId(args.staleOpenCodeSessionId).catch((error) => {
    console.warn('[slack] Failed to delete stale DM session bindings', {
      error,
      openCodeSessionId: args.staleOpenCodeSessionId,
    })
  })
  return createSlackDmSession(args)
}

function formatSlackReply(replyText: string, prefixes: Array<string | undefined>): string {
  const uniquePrefixes = prefixes.filter((prefix, index): prefix is string => Boolean(prefix) && prefixes.indexOf(prefix) === index)
  return uniquePrefixes.length > 0
    ? `${uniquePrefixes.join('\n\n')}\n\n${replyText}`
    : replyText
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
    text: 'More than 2 hours have passed since the last conversation. Do you want to continue the previous conversation or start a new one?',
  })
}

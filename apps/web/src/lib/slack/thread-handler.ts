import { createInstanceClient } from '@/lib/opencode/client'
import {
  captureSessionMessageCursor,
  createSessionPromptRun,
  ensureWorkspaceRunningForExecution,
  isOpenCodeSessionNotFoundError,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/opencode/session-execution'
import { openCodeSessionExists } from '@/lib/opencode/session-utils'
import { messageRunService, slackService } from '@/lib/services'
import { buildSlackContext } from '@/lib/slack/context'
import { buildSlackPrompt } from '@/lib/slack/prompt'
import { ensureSlackServiceUser } from '@/lib/slack/service-user'
import { withSlackThreadLock } from '@/lib/slack/socket-locks'
import type { SlackChatClient, SlackMessageEvent } from '@/lib/slack/socket-types'
import {
  buildSlackSessionTitle,
  buildSlackThreadKey,
  finalizeSlackReply,
  mapSlackFailureToMessage,
  postSlackPlaceholder,
  resolveTargetAgentId,
  stripBotMention,
} from '@/lib/slack/socket-utils'

const STALE_THREAD_SESSION_MESSAGE = 'The previous Slack thread conversation was no longer available, so I started a new conversation.'

export async function handleSlackThreadEvent(args: {
  channel: string
  client: SlackChatClient
  event: SlackMessageEvent
  eventTs: string
  isMention: boolean
  savedBotUserId: string | null
  threadTs: string
}): Promise<void> {
  await withSlackThreadLock(buildSlackThreadKey(args.channel, args.threadTs), async () => {
    const existingBinding = await slackService.findThreadBinding(args.channel, args.threadTs)
    if (!args.isMention && (!args.event.thread_ts || args.event.thread_ts === args.eventTs || !existingBinding)) {
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
      let messagePrefix: string | undefined

      if (sessionId) {
        const sessionExists = await openCodeSessionExists(opencodeClient, sessionId)
        if (!sessionExists) {
          await slackService.deleteSessionBindingsByOpenCodeSessionId(sessionId).catch((error) => {
            console.warn('[slack] Failed to delete stale thread session bindings', {
              error,
              openCodeSessionId: sessionId,
            })
          })
          sessionId = null
          messagePrefix = STALE_THREAD_SESSION_MESSAGE
        }
      }

      if (!sessionId) {
        sessionId = await createSlackThreadSession({
          channelId: args.channel,
          executionUserId: serviceUser.user.id,
          opencodeClient,
          threadTs: args.threadTs,
        })
      }

      const agentId = await resolveTargetAgentId((await slackService.findIntegration())?.defaultAgentId ?? null)
      const context = await buildSlackContext(args.client, {
        channel: args.channel,
        text: stripBotMention(args.event.text ?? '', args.savedBotUserId),
        threadTs: args.event.thread_ts ?? null,
        ts: args.eventTs,
        user: args.event.user ?? null,
      })
      const prompt = buildSlackPrompt(context)

      placeholderTs = await postSlackPlaceholder(args.client, args.channel, args.threadTs)
      let replyText: string
      try {
        replyText = await sendSlackThreadPromptToSession({
          agentId,
          opencodeClient,
          prompt,
          sessionId,
          slug: serviceUser.user.slug,
        })
      } catch (error) {
        if (!isOpenCodeSessionNotFoundError(error)) {
          throw error
        }

        await slackService.deleteSessionBindingsByOpenCodeSessionId(sessionId).catch((cleanupError) => {
          console.warn('[slack] Failed to delete stale thread session bindings', {
            error: cleanupError,
            openCodeSessionId: sessionId,
          })
        })
        sessionId = await createSlackThreadSession({
          channelId: args.channel,
          executionUserId: serviceUser.user.id,
          opencodeClient,
          threadTs: args.threadTs,
        })
        messagePrefix = STALE_THREAD_SESSION_MESSAGE
        replyText = await sendSlackThreadPromptToSession({
          agentId,
          opencodeClient,
          prompt,
          sessionId,
          slug: serviceUser.user.slug,
        })
      }

      await finalizeSlackReply(args.client, args.channel, args.threadTs, placeholderTs, formatSlackThreadReply(replyText, messagePrefix))
      await slackService.markLastError(null).catch(() => undefined)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'slack_error'
      await finalizeSlackReply(
        args.client,
        args.channel,
        args.threadTs,
        placeholderTs,
        'I hit an error while preparing the Slack reply. Please try again.',
      ).catch(() => undefined)
      await slackService.markLastError(detail).catch(() => undefined)
      throw error
    }
  })
}

async function createSlackThreadSession(args: {
  channelId: string
  executionUserId: string
  opencodeClient: NonNullable<Awaited<ReturnType<typeof createInstanceClient>>>
  threadTs: string
}): Promise<string> {
  const sessionResult = await args.opencodeClient.session.create(
    { title: buildSlackSessionTitle(args.channelId, args.threadTs) },
    { throwOnError: true },
  )
  if (!sessionResult.data) {
    throw new Error('slack_session_create_failed')
  }

  await slackService.upsertThreadBinding({
    channelId: args.channelId,
    executionUserId: args.executionUserId,
    openCodeSessionId: sessionResult.data.id,
    threadTs: args.threadTs,
  })

  return sessionResult.data.id
}

async function sendSlackThreadPromptToSession(args: {
  agentId: string | null
  opencodeClient: NonNullable<Awaited<ReturnType<typeof createInstanceClient>>>
  prompt: string
  sessionId: string
  slug: string
}): Promise<string> {
  const runResult = await createSessionPromptRun({
    client: args.opencodeClient,
    sessionId: args.sessionId,
    slug: args.slug,
    source: 'slack_thread',
  })
  if (!runResult.ok) {
    return mapSlackFailureToMessage('session_busy')
  }

  const runId = runResult.run.id
  try {
    const sessionCursor = await captureSessionMessageCursor(args.opencodeClient, args.sessionId)
    await args.opencodeClient.session.promptAsync(
      {
        agent: args.agentId ?? undefined,
        parts: [{ type: 'text', text: args.prompt }],
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

    if (failure) {
      if (failure === 'autopilot_run_timeout') {
        await args.opencodeClient.session.abort({ sessionID: args.sessionId }).catch(() => undefined)
      }
      await messageRunService.markRunFailed(runId, failure)
      return mapSlackFailureToMessage(failure)
    }

    await messageRunService.markRunSucceeded(runId)
    return (await readLatestAssistantText(args.opencodeClient, args.sessionId, sessionCursor)) ?? 'I could not produce a Slack-ready text response.'
  } catch (error) {
    await messageRunService.markRunFailed(
      runId,
      error instanceof Error ? error.message : 'slack_thread_prompt_failed',
    )
    throw error
  }
}

function formatSlackThreadReply(replyText: string, messagePrefix: string | undefined): string {
  return messagePrefix ? `${messagePrefix}\n\n${replyText}` : replyText
}

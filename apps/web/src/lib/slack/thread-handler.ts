import type { HarnessRuntime } from '@/lib/harness/contract'
import type { HarnessResult } from '@/lib/harness/errors'
import {
  captureSessionMessageCursor,
  createSessionPromptRun,
  EXECUTION_TERMINATION_UNCONFIRMED_ERROR,
  ensureWorkspaceRunningForExecution,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/harness/execution'
import { getRuntimeForSlug } from '@/lib/harness/registry'
import { messageRunService, slackService } from '@/lib/services'
import { isArchivedSession } from '@/lib/services/legacy-session-archive'
import { buildSlackContext } from '@/lib/slack/context'
import { formatSlackMessages } from '@/lib/slack/formatter'
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

type SlackThreadFailure = { ok: false; error: string }

export async function handleSlackThreadEvent(args: {
  channel: string
  client: SlackChatClient
  event: SlackMessageEvent
  eventTs: string
  isMention: boolean
  savedBotUserId: string | null
  threadTs: string
}): Promise<void | SlackThreadFailure> {
  return withSlackThreadLock(buildSlackThreadKey(args.channel, args.threadTs), async () => {
    const existingBinding = await slackService.findThreadBinding(args.channel, args.threadTs)
    if (!args.isMention && (!args.event.thread_ts || args.event.thread_ts === args.eventTs || !existingBinding)) {
      return
    }

    let placeholderTs: string | null = null
    const fail = async (error: string): Promise<SlackThreadFailure> => {
      await finalizeSlackReply(
        args.client,
        args.channel,
        args.threadTs,
        placeholderTs,
        'I hit an error while preparing the Slack reply. Please try again.',
      ).catch(() => undefined)
      await slackService.markLastError(error).catch(() => undefined)
      return { ok: false, error }
    }

    try {
      const serviceUser = await ensureSlackServiceUser()
      if (!serviceUser.ok) {
        throw new Error(serviceUser.error)
      }

      const workspace = await ensureWorkspaceRunningForExecution(serviceUser.user.slug, serviceUser.user.id)
      if (!workspace.ok) return fail(workspace.error)

      const runtimeResult = await getRuntimeForSlug(serviceUser.user.slug)
      if (!runtimeResult.ok) return fail(runtimeResult.error.code)
      const opencodeClient = runtimeResult.data

      let sessionId = existingBinding?.openCodeSessionId ?? null
      let messagePrefix: string | undefined

      if (sessionId && await isArchivedSession(serviceUser.user.slug, sessionId)) {
        sessionId = null
        messagePrefix = STALE_THREAD_SESSION_MESSAGE
      }

      if (sessionId) {
        const session = await opencodeClient.getSession(sessionId)
        if (!session.ok && session.error.code !== 'session_not_found') return fail(session.error.code)
        if (!session.ok) {
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
        const session = await createSlackThreadSession({
          channelId: args.channel,
          executionUserId: serviceUser.user.id,
          opencodeClient,
          threadTs: args.threadTs,
        })
        if (!session.ok) return fail(session.error.code)
        sessionId = session.data
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
      let reply: HarnessResult<string>
      try {
        reply = await sendSlackThreadPromptToSession({
          agentId,
          opencodeClient,
          prompt,
          sessionId,
          slug: serviceUser.user.slug,
          userId: serviceUser.user.id,
        })
      } catch (error) {
        if (!(error instanceof Error && error.message === 'session_not_found')) {
          throw error
        }
        reply = { ok: false, error: { code: 'session_not_found' } }
      }

      if (!reply.ok && reply.error.code === 'session_not_found') {
        await slackService.deleteSessionBindingsByOpenCodeSessionId(sessionId).catch((cleanupError) => {
          console.warn('[slack] Failed to delete stale thread session bindings', {
            error: cleanupError,
            openCodeSessionId: sessionId,
          })
        })
        const session = await createSlackThreadSession({
          channelId: args.channel,
          executionUserId: serviceUser.user.id,
          opencodeClient,
          threadTs: args.threadTs,
        })
        if (!session.ok) return fail(session.error.code)
        sessionId = session.data
        messagePrefix = STALE_THREAD_SESSION_MESSAGE
        reply = await sendSlackThreadPromptToSession({
          agentId,
          opencodeClient,
          prompt,
          sessionId,
          slug: serviceUser.user.slug,
          userId: serviceUser.user.id,
        })
      }
      if (!reply.ok) return fail(reply.error.code)

      const messages = formatSlackMessages(
        formatSlackThreadReply(reply.data, messagePrefix),
        context.mentionTokens,
      )
      await finalizeSlackReply(args.client, args.channel, args.threadTs, placeholderTs, messages)
      await slackService.markLastError(null).catch(() => undefined)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'slack_error'
      await fail(detail)
      throw error
    }
  })
}

async function createSlackThreadSession(args: {
  channelId: string
  executionUserId: string
  opencodeClient: HarnessRuntime
  threadTs: string
}): Promise<HarnessResult<string>> {
  const sessionResult = await args.opencodeClient.createSession({ title: buildSlackSessionTitle(args.channelId, args.threadTs) })
  if (!sessionResult.ok) return sessionResult

  await slackService.upsertThreadBinding({
    channelId: args.channelId,
    executionUserId: args.executionUserId,
    openCodeSessionId: sessionResult.data.id,
    threadTs: args.threadTs,
  })

  return { ok: true, data: sessionResult.data.id }
}

async function sendSlackThreadPromptToSession(args: {
  agentId: string | null
  opencodeClient: HarnessRuntime
  prompt: string
  sessionId: string
  slug: string
  userId: string
}): Promise<HarnessResult<string>> {
  const runResult = await createSessionPromptRun({
    client: args.opencodeClient,
    sessionId: args.sessionId,
    slug: args.slug,
    source: 'slack_thread',
  })
  if (!runResult.ok) {
    return { ok: true, data: mapSlackFailureToMessage('session_busy') }
  }

  const runId = runResult.run.id
  try {
    const sessionCursor = await captureSessionMessageCursor(args.opencodeClient, args.sessionId)
    if (!sessionCursor.ok) {
      await messageRunService.markRunFailed(runId, sessionCursor.error.code)
      return sessionCursor
    }
    const submitted = await args.opencodeClient.prompt({
      agent: args.agentId ?? undefined,
      parts: [{ type: 'text', text: args.prompt }],
      sessionId: args.sessionId,
    })
    if (!submitted.ok) {
      await messageRunService.markRunFailed(runId, submitted.error.code)
      return submitted
    }

    const completion = await waitForSessionToComplete({
      client: args.opencodeClient,
      cursor: sessionCursor.data,
      sessionId: args.sessionId,
      slug: args.slug,
      usage: { messageRunId: runId, source: 'slack_thread', userId: args.userId },
    })

    if (completion.status === 'error') {
      await messageRunService.markRunFailed(runId, completion.error.code)
      return { ok: false, error: completion.error }
    }

    if (completion.status === 'termination_unconfirmed') {
      console.warn('[slack] Runtime termination unconfirmed', { cause: completion.cause })
      return { ok: true, data: mapSlackFailureToMessage(EXECUTION_TERMINATION_UNCONFIRMED_ERROR) }
    }

    if (completion.status === 'failed') {
      await messageRunService.markRunFailed(runId, completion.error)
      return { ok: true, data: mapSlackFailureToMessage(completion.error) }
    }

    await messageRunService.markRunSucceeded(runId)
    const reply = await readLatestAssistantText(args.opencodeClient, args.sessionId, sessionCursor.data)
    if (!reply.ok) {
      await messageRunService.markRunFailed(runId, reply.error.code)
      return reply
    }
    return { ok: true, data: reply.data ?? 'I could not produce a Slack-ready text response.' }
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

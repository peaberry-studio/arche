import { createInstanceClient } from '@/lib/opencode/client'
import {
  captureSessionMessageCursor,
  createSessionPromptRun,
  ensureWorkspaceRunningForExecution,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/opencode/session-execution'
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
      if (!sessionId) {
        const sessionResult = await opencodeClient.session.create(
          { title: buildSlackSessionTitle(args.channel, args.threadTs) },
          { throwOnError: true },
        )
        if (!sessionResult.data) {
          throw new Error('slack_session_create_failed')
        }

        sessionId = sessionResult.data.id
        await slackService.upsertThreadBinding({
          channelId: args.channel,
          executionUserId: serviceUser.user.id,
          openCodeSessionId: sessionId,
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
      const runResult = await createSessionPromptRun({
        client: opencodeClient,
        sessionId,
        slug: serviceUser.user.slug,
        source: 'slack_thread',
      })
      if (!runResult.ok) {
        await finalizeSlackReply(
          args.client,
          args.channel,
          args.threadTs,
          placeholderTs,
          mapSlackFailureToMessage('session_busy'),
        )
        return
      }

      const runId = runResult.run.id
      let sessionCursor: Awaited<ReturnType<typeof captureSessionMessageCursor>> | null = null
      let failure: string | null = null
      try {
        sessionCursor = await captureSessionMessageCursor(opencodeClient, sessionId)
        await opencodeClient.session.promptAsync(
          {
            agent: agentId ?? undefined,
            parts: [{ type: 'text', text: prompt }],
            sessionID: sessionId,
          },
          { throwOnError: true },
        )

        failure = await waitForSessionToComplete({
          client: opencodeClient,
          cursor: sessionCursor,
          sessionId,
          slug: serviceUser.user.slug,
        })
      } catch (error) {
        await messageRunService.markRunFailed(
          runId,
          error instanceof Error ? error.message : 'slack_thread_prompt_failed',
        )
        throw error
      }

      if (failure) {
        if (failure === 'autopilot_run_timeout') {
          await opencodeClient.session.abort({ sessionID: sessionId }).catch(() => undefined)
        }
        await messageRunService.markRunFailed(runId, failure)
      } else {
        await messageRunService.markRunSucceeded(runId)
      }

      const replyText = failure
        ? mapSlackFailureToMessage(failure)
        : sessionCursor
          ? (await readLatestAssistantText(opencodeClient, sessionId, sessionCursor)) ?? 'I could not produce a Slack-ready text response.'
          : 'I could not produce a Slack-ready text response.'

      await finalizeSlackReply(args.client, args.channel, args.threadTs, placeholderTs, replyText)
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

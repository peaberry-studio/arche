import { createInstanceClient } from '@/lib/opencode/client'
import {
  captureSessionMessageCursor,
  ensureWorkspaceRunningForExecution,
  readLatestAssistantText,
  waitForSessionToComplete,
} from '@/lib/opencode/session-execution'
import { slackService } from '@/lib/services'
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

type SlackContextEvent = {
  channel: string
  text: string
  threadTs: string | null
  ts: string
  user: string | null
}

type SlackConversationClient = {
  conversations: {
    history: (args: { channel: string; inclusive: boolean; latest: string; limit: number }) => Promise<unknown>
    replies: (args: { channel: string; limit: number; ts: string }) => Promise<unknown>
  }
  users: {
    info: (args: { user: string }) => Promise<unknown>
  }
}

type SlackMessageLike = {
  botId: string | null
  text: string
  ts: string
  user: string | null
}

const CHANNEL_CONTEXT_LIMIT = 8
const THREAD_CONTEXT_LIMIT = 12

export async function buildSlackContext(
  client: SlackConversationClient,
  event: SlackContextEvent,
): Promise<{ contextText: string; mentionTokens: string[] }> {
  const history = event.threadTs
    ? await loadThreadMessages(client, event.channel, event.threadTs)
    : await loadChannelMessages(client, event.channel, event.ts)

  const userIds = Array.from(
    new Set(
      history
        .map((message) => message.user)
        .concat(event.user)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  )
  const userLabels = await resolveUserLabels(client, userIds)
  const mentionTokens = Array.from(new Set(userIds.map((userId) => `<@${userId}>`))).sort((left, right) => left.localeCompare(right))

  const historyLines = history.map((message) => formatSlackMessage(message, userLabels))
  const eventAuthor = event.user ? userLabels.get(event.user) ?? `<@${event.user}>` : 'Unknown user'

  const lines = [
    `Channel: ${event.channel}`,
    `Thread: ${event.threadTs ?? 'new thread'}`,
    'Known Slack users:',
    ...(mentionTokens.length > 0
      ? mentionTokens.map((token) => `- ${token}${formatUserLabel(token, userLabels)}`)
      : ['- none provided']),
    event.threadTs ? 'Recent thread history:' : 'Recent channel history:',
    ...(historyLines.length > 0 ? historyLines : ['- no recent Slack history available']),
    'Newest Slack message:',
    `- ${eventAuthor}: ${event.text.trim() || '[no text]'}`,
  ]

  return {
    contextText: lines.join('\n'),
    mentionTokens,
  }
}

function formatSlackMessage(message: SlackMessageLike, userLabels: Map<string, string>): string {
  if (message.user) {
    return `- ${userLabels.get(message.user) ?? `<@${message.user}>`}: ${message.text || '[no text]'}`
  }
  if (message.botId) {
    return `- Bot(${message.botId}): ${message.text || '[no text]'}`
  }

  return `- Unknown: ${message.text || '[no text]'}`
}

function formatUserLabel(token: string, userLabels: Map<string, string>): string {
  const userId = token.slice(2, -1)
  const label = userLabels.get(userId)
  return label ? ` = ${label}` : ''
}

async function loadChannelMessages(
  client: SlackConversationClient,
  channel: string,
  latest: string,
): Promise<SlackMessageLike[]> {
  try {
    const response = await client.conversations.history({
      channel,
      inclusive: true,
      latest,
      limit: CHANNEL_CONTEXT_LIMIT,
    })

    return extractMessages(response)
  } catch {
    return []
  }
}

async function loadThreadMessages(
  client: SlackConversationClient,
  channel: string,
  threadTs: string,
): Promise<SlackMessageLike[]> {
  try {
    const response = await client.conversations.replies({
      channel,
      limit: THREAD_CONTEXT_LIMIT,
      ts: threadTs,
    })

    return extractMessages(response)
  } catch {
    return []
  }
}

function extractMessages(response: unknown): SlackMessageLike[] {
  const rawMessages = (response as { messages?: unknown }).messages
  if (!Array.isArray(rawMessages)) {
    return []
  }

  return rawMessages
    .map((message) => {
      if (!message || typeof message !== 'object') {
        return null
      }

      const record = message as Record<string, unknown>
      const ts = typeof record.ts === 'string' ? record.ts : null
      if (!ts) {
        return null
      }

      return {
        botId: typeof record.bot_id === 'string' ? record.bot_id : null,
        text: typeof record.text === 'string' ? record.text.trim() : '',
        ts,
        user: typeof record.user === 'string' ? record.user : null,
      }
    })
    .filter((message): message is SlackMessageLike => message !== null)
    .sort((left, right) => left.ts.localeCompare(right.ts))
}

async function resolveUserLabels(
  client: SlackConversationClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>()

  await Promise.all(
    userIds.map(async (userId) => {
      try {
        const response = await client.users.info({ user: userId })
        const user = (response as { user?: unknown }).user
        if (!user || typeof user !== 'object') {
          labels.set(userId, `<@${userId}>`)
          return
        }

        const record = user as Record<string, unknown>
        const profile = record.profile as Record<string, unknown> | undefined
        const displayName = typeof profile?.display_name === 'string' ? profile.display_name.trim() : ''
        const realName = typeof profile?.real_name === 'string' ? profile.real_name.trim() : ''
        const fallbackName = typeof record.name === 'string' ? record.name.trim() : ''
        const label = displayName || realName || fallbackName || `<@${userId}>`
        labels.set(userId, `${label} (<@${userId}>)`)
      } catch {
        labels.set(userId, `<@${userId}>`)
      }
    }),
  )

  return labels
}

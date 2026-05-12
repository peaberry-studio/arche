export type SlackBlock = Record<string, unknown>

export type SlackEventEnvelope = {
  event_id?: string
}

export type SlackMessageEvent = {
  bot_id?: string
  channel?: string
  channel_type?: string
  subtype?: string
  text?: string
  thread_ts?: string
  ts?: string
  user?: string
}

export type SlackChatClient = {
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

export type SlackCommandBody = {
  channel_id?: string
  channel_name?: string
  team_id?: string
  text?: string
  user_id?: string
}

export type SlackCommandRespond = (args: { response_type?: 'ephemeral' | 'in_channel'; text: string }) => Promise<unknown>

export type SlackActionTarget = {
  channelId: string
  messageTs: string
}

export type SlackActionContext = {
  channelId: string
  slackTeamId: string
  slackUserId: string
}

export type SlackUserProfile = {
  displayName: string | null
  email: string | null
}

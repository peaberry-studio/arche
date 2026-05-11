export const SLACK_INTEGRATION_KEY = 'slack'

export type SlackIntegrationRecord = {
  singletonKey: string
  enabled: boolean
  botTokenSecret: string | null
  appTokenSecret: string | null
  slackTeamId: string | null
  slackAppId: string | null
  slackBotUserId: string | null
  defaultAgentId: string | null
  lastError: string | null
  lastSocketConnectedAt: Date | null
  lastEventAt: Date | null
  version: number
  createdAt: Date
  updatedAt: Date
  configCorrupted?: boolean
}

export type SlackThreadBindingRecord = {
  id: string
  channelId: string
  threadTs: string
  openCodeSessionId: string
  executionUserId: string
  createdAt: Date
  updatedAt: Date
}

export type SlackUserLinkRecord = {
  id: string
  userId: string
  slackTeamId: string
  slackUserId: string
  slackEmail: string | null
  displayName: string | null
  lastSeenAt: Date
  createdAt: Date
  updatedAt: Date
}

export type SlackDmSessionBindingRecord = {
  id: string
  slackTeamId: string
  slackUserId: string
  channelId: string
  executionUserId: string
  openCodeSessionId: string
  startedAt: Date
  lastMessageAt: Date
  createdAt: Date
  updatedAt: Date
}

export type SlackPendingDmDecisionRecord = {
  id: string
  sourceEventId: string
  slackTeamId: string
  slackUserId: string
  channelId: string
  sourceTs: string
  messageText: string
  previousDmSessionBindingId: string | null
  expiresAt: Date
  status: 'pending' | 'continued' | 'started_new' | 'expired'
  createdAt: Date
  updatedAt: Date
}

export type SlackNotificationChannelRecord = {
  id: string
  slackTeamId: string
  channelId: string
  name: string
  isPrivate: boolean
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type SlackNotificationTarget =
  | { type: 'dm'; userId: string }
  | { type: 'channel'; channelId: string }

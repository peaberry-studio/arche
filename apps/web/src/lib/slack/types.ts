export type SlackIntegrationStatus = 'disabled' | 'connecting' | 'connected' | 'error'

export type SlackAgentOption = {
  id: string
  displayName: string
  isPrimary: boolean
}

export type SlackIntegrationSummary = {
  enabled: boolean
  status: SlackIntegrationStatus
  configured: boolean
  hasBotToken: boolean
  hasAppToken: boolean
  slackTeamId: string | null
  slackAppId: string | null
  slackBotUserId: string | null
  defaultAgentId: string | null
  resolvedDefaultAgentId: string | null
  lastError: string | null
  lastSocketConnectedAt: string | null
  lastEventAt: string | null
  version: number
  updatedAt: string | null
}

export type SlackNotificationChannel = {
  id: string
  slackTeamId: string
  channelId: string
  name: string
  isPrivate: boolean
  enabled: boolean
  createdAt: string | Date
  updatedAt: string | Date
}

export type SlackIntegrationGetResponse = {
  agents: SlackAgentOption[]
  integration: SlackIntegrationSummary
}

export type SlackIntegrationMutateRequest = {
  appToken?: string
  botToken?: string
  defaultAgentId?: string | null
  enabled?: boolean
  reconnect?: boolean
}

export type SlackIntegrationMutateResponse = SlackIntegrationGetResponse

export type SlackIntegrationTestRequest = {
  appToken?: string
  botToken?: string
}

export type SlackIntegrationTestResponse = {
  appId: string | null
  botUserId: string | null
  ok: boolean
  socketUrlAvailable: boolean
  teamId: string | null
}

import { encryptConfig, decryptConfig } from '@/lib/connectors/crypto'
import { prisma } from '@/lib/prisma'

import { findByKey, updateStateByKey, upsertByKey } from './external-integrations'

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

type SlackConfig = {
  enabled?: boolean
  botTokenSecret?: string | null
  appTokenSecret?: string | null
  defaultAgentId?: string | null
}

type SlackState = {
  slackTeamId?: string | null
  slackAppId?: string | null
  slackBotUserId?: string | null
  lastError?: string | null
  lastSocketConnectedAt?: string | null
  lastEventAt?: string | null
}

function parseState(state: unknown): SlackState {
  if (typeof state === 'string') {
    try {
      return JSON.parse(state) as SlackState
    } catch {
      return {}
    }
  }
  if (state && typeof state === 'object') {
    return state as SlackState
  }
  return {}
}

function toRecord(row: { key: string; config: string; state: unknown; version: number; createdAt: Date; updatedAt: Date }): SlackIntegrationRecord {
  const config = decryptConfig(row.config) as SlackConfig
  const state = parseState(row.state)

  return {
    singletonKey: row.key,
    enabled: config.enabled ?? false,
    botTokenSecret: config.botTokenSecret ?? null,
    appTokenSecret: config.appTokenSecret ?? null,
    slackTeamId: state.slackTeamId ?? null,
    slackAppId: state.slackAppId ?? null,
    slackBotUserId: state.slackBotUserId ?? null,
    defaultAgentId: config.defaultAgentId ?? null,
    lastError: state.lastError ?? null,
    lastSocketConnectedAt: state.lastSocketConnectedAt ? new Date(state.lastSocketConnectedAt) : null,
    lastEventAt: state.lastEventAt ? new Date(state.lastEventAt) : null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function findIntegration(): Promise<SlackIntegrationRecord | null> {
  const row = await findByKey(SLACK_INTEGRATION_KEY)
  if (!row) return null
  return toRecord(row)
}

export async function saveIntegrationConfig(args: {
  enabled: boolean
  botTokenSecret?: string | null
  appTokenSecret?: string | null
  slackTeamId?: string | null
  slackAppId?: string | null
  slackBotUserId?: string | null
  defaultAgentId?: string | null
  clearLastError?: boolean
}): Promise<SlackIntegrationRecord> {
  const existing = await findByKey(SLACK_INTEGRATION_KEY)
  const existingConfig = existing ? (decryptConfig(existing.config) as SlackConfig) : {}
  const existingState = existing ? parseState(existing.state) : {}

  const nextConfig: SlackConfig = {
    enabled: args.enabled,
    botTokenSecret: args.botTokenSecret !== undefined ? args.botTokenSecret : existingConfig.botTokenSecret,
    appTokenSecret: args.appTokenSecret !== undefined ? args.appTokenSecret : existingConfig.appTokenSecret,
    defaultAgentId: args.defaultAgentId !== undefined ? args.defaultAgentId : existingConfig.defaultAgentId,
  }

  const nextState: SlackState = {
    slackTeamId: args.slackTeamId !== undefined ? args.slackTeamId : existingState.slackTeamId,
    slackAppId: args.slackAppId !== undefined ? args.slackAppId : existingState.slackAppId,
    slackBotUserId: args.slackBotUserId !== undefined ? args.slackBotUserId : existingState.slackBotUserId,
    lastError: args.clearLastError ? null : existingState.lastError,
    lastSocketConnectedAt: existingState.lastSocketConnectedAt,
    lastEventAt: existingState.lastEventAt,
  }

  const row = await upsertByKey(SLACK_INTEGRATION_KEY, encryptConfig(nextConfig), nextState)
  return toRecord(row)
}

export async function clearIntegration(): Promise<SlackIntegrationRecord> {
  const row = await upsertByKey(
    SLACK_INTEGRATION_KEY,
    encryptConfig({ enabled: false }),
    {},
  )
  return toRecord(row)
}

export async function markSocketConnected(connectedAt: Date) {
  const existing = await findByKey(SLACK_INTEGRATION_KEY)
  const state = existing ? parseState(existing.state) : {}
  state.lastSocketConnectedAt = connectedAt.toISOString()
  state.lastError = null

  await updateStateByKey(SLACK_INTEGRATION_KEY, state)
}

export async function markEventReceived(receivedAt: Date) {
  const existing = await findByKey(SLACK_INTEGRATION_KEY)
  const state = existing ? parseState(existing.state) : {}
  state.lastEventAt = receivedAt.toISOString()

  await updateStateByKey(SLACK_INTEGRATION_KEY, state)
}

export async function markLastError(lastError: string | null) {
  const existing = await findByKey(SLACK_INTEGRATION_KEY)
  const state = existing ? parseState(existing.state) : {}
  state.lastError = lastError

  await updateStateByKey(SLACK_INTEGRATION_KEY, state)
}

export async function hasEventReceipt(eventId: string): Promise<boolean> {
  const receipt = await prisma.slackEventReceipt.findUnique({
    where: { eventId },
    select: { id: true },
  })

  return Boolean(receipt)
}

export async function recordEventReceipt(args: {
  eventId: string
  type: string
  receivedAt: Date
}): Promise<boolean> {
  try {
    await prisma.slackEventReceipt.create({
      data: {
        eventId: args.eventId,
        type: args.type,
        receivedAt: args.receivedAt,
      },
    })
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return false
    }

    throw error
  }
}

export function pruneEventReceipts(olderThan: Date) {
  return prisma.slackEventReceipt.deleteMany({
    where: {
      receivedAt: {
        lt: olderThan,
      },
    },
  })
}

export function findThreadBinding(channelId: string, threadTs: string): Promise<SlackThreadBindingRecord | null> {
  return prisma.slackThreadBinding.findUnique({
    where: {
      channelId_threadTs: {
        channelId,
        threadTs,
      },
    },
  })
}

export function upsertThreadBinding(args: {
  channelId: string
  threadTs: string
  openCodeSessionId: string
  executionUserId: string
}): Promise<SlackThreadBindingRecord> {
  return prisma.slackThreadBinding.upsert({
    where: {
      channelId_threadTs: {
        channelId: args.channelId,
        threadTs: args.threadTs,
      },
    },
    create: args,
    update: {
      openCodeSessionId: args.openCodeSessionId,
      executionUserId: args.executionUserId,
    },
  })
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

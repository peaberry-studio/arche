import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import { findByKey, updateStateByKey, upsertByKey } from '@/lib/services/external-integrations'
import {
  SLACK_INTEGRATION_KEY,
  type SlackIntegrationRecord,
} from '@/lib/services/slack/records'

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

function safeDecryptConfig(encryptedConfig: string): { ok: true; config: SlackConfig } | { ok: false } {
  try {
    return { ok: true, config: decryptConfig(encryptedConfig) as SlackConfig }
  } catch (error) {
    console.error('[slack] Failed to decrypt integration config', error instanceof Error ? error.message : error)
    return { ok: false }
  }
}

function toRecord(row: { key: string; config: string; state: unknown; version: number; createdAt: Date; updatedAt: Date }): SlackIntegrationRecord {
  const decryptResult = safeDecryptConfig(row.config)
  const config = decryptResult.ok ? decryptResult.config : {}
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
    configCorrupted: !decryptResult.ok,
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
  const existingDecrypt = existing ? safeDecryptConfig(existing.config) : { ok: true, config: {} as SlackConfig }
  const existingConfig = existingDecrypt.ok ? existingDecrypt.config : {}
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

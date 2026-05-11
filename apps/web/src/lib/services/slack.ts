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

async function createSlackAuditEvent(args: {
  actorUserId?: string | null
  action: string
  metadata?: unknown
}): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorUserId: args.actorUserId ?? null,
        action: args.action,
        metadata: args.metadata ?? undefined,
      },
    })
  } catch (error) {
    console.warn('[slack] audit event failed:', args.action, error)
  }
}

function normalizeOptionalSlackText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
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

export function findUserLinkBySlackUser(
  slackTeamId: string,
  slackUserId: string,
): Promise<SlackUserLinkRecord | null> {
  return prisma.slackUserLink.findUnique({
    where: {
      slackTeamId_slackUserId: {
        slackTeamId,
        slackUserId,
      },
    },
  })
}

export async function upsertUserLink(data: {
  userId: string
  slackTeamId: string
  slackUserId: string
  slackEmail: string | null
  displayName: string | null
}): Promise<SlackUserLinkRecord> {
  const slackEmail = normalizeOptionalSlackText(data.slackEmail)
  const displayName = normalizeOptionalSlackText(data.displayName)
  const existing = await findUserLinkBySlackUser(data.slackTeamId, data.slackUserId)
  const lastSeenAt = new Date()

  const link = await prisma.slackUserLink.upsert({
    where: {
      slackTeamId_slackUserId: {
        slackTeamId: data.slackTeamId,
        slackUserId: data.slackUserId,
      },
    },
    create: {
      displayName,
      lastSeenAt,
      slackEmail,
      slackTeamId: data.slackTeamId,
      slackUserId: data.slackUserId,
      userId: data.userId,
    },
    update: {
      displayName,
      lastSeenAt,
      slackEmail,
      userId: data.userId,
    },
  })

  if (!existing || existing.userId !== data.userId) {
    await createSlackAuditEvent({
      actorUserId: data.userId,
      action: 'slack.user_linked',
      metadata: {
        slackEmail,
        slackTeamId: data.slackTeamId,
        slackUserId: data.slackUserId,
      },
    })
  }

  return link
}

export async function resolveArcheUserFromSlackUser(
  slackTeamId: string,
  slackUserId: string,
  slackEmail: string | null,
  displayName: string | null,
): Promise<{ ok: true; user: { id: string; slug: string } } | { ok: false; error: string }> {
  const existing = await prisma.slackUserLink.findUnique({
    where: {
      slackTeamId_slackUserId: {
        slackTeamId,
        slackUserId,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          kind: true,
          slug: true,
        },
      },
    },
  })

  if (existing) {
    if (existing.user.kind !== 'HUMAN') {
      return { ok: false, error: 'slack_user_not_linked_to_human' }
    }

    await prisma.slackUserLink.update({
      where: { id: existing.id },
      data: {
        displayName: normalizeOptionalSlackText(displayName),
        lastSeenAt: new Date(),
        slackEmail: normalizeOptionalSlackText(slackEmail),
      },
    })

    return {
      ok: true,
      user: {
        id: existing.user.id,
        slug: existing.user.slug,
      },
    }
  }

  const email = normalizeOptionalSlackText(slackEmail)
  if (!email) {
    return { ok: false, error: 'slack_email_missing' }
  }

  const emailCandidates = Array.from(new Set([email, email.toLowerCase()]))
  const user = await prisma.user.findFirst({
    where: {
      kind: 'HUMAN',
      OR: emailCandidates.map((candidate) => ({ email: candidate })),
    },
    select: {
      id: true,
      slug: true,
    },
  })

  if (!user) {
    return { ok: false, error: 'slack_email_not_found' }
  }

  await upsertUserLink({
    displayName,
    slackEmail: email,
    slackTeamId,
    slackUserId,
    userId: user.id,
  })

  return { ok: true, user }
}

export function findLatestDmSession(
  slackTeamId: string,
  slackUserId: string,
): Promise<SlackDmSessionBindingRecord | null> {
  return prisma.slackDmSessionBinding.findFirst({
    where: {
      slackTeamId,
      slackUserId,
    },
    orderBy: {
      lastMessageAt: 'desc',
    },
  })
}

export function findDmSessionBindingById(
  id: string,
): Promise<SlackDmSessionBindingRecord | null> {
  return prisma.slackDmSessionBinding.findUnique({ where: { id } })
}

export async function createDmSessionBinding(data: {
  slackTeamId: string
  slackUserId: string
  channelId: string
  executionUserId: string
  openCodeSessionId: string
}): Promise<SlackDmSessionBindingRecord> {
  const binding = await prisma.slackDmSessionBinding.create({
    data,
  })

  await createSlackAuditEvent({
    actorUserId: data.executionUserId,
    action: 'slack.dm_session_created',
    metadata: {
      channelId: data.channelId,
      openCodeSessionId: data.openCodeSessionId,
      slackTeamId: data.slackTeamId,
      slackUserId: data.slackUserId,
    },
  })

  return binding
}

export async function touchDmSessionBinding(
  bindingId: string,
  lastMessageAt: Date,
): Promise<void> {
  await prisma.slackDmSessionBinding.update({
    where: { id: bindingId },
    data: { lastMessageAt },
  })
}

export function createPendingDmDecision(data: {
  sourceEventId: string
  slackTeamId: string
  slackUserId: string
  channelId: string
  sourceTs: string
  messageText: string
  previousDmSessionBindingId: string | null
  expiresAt: Date
}): Promise<SlackPendingDmDecisionRecord> {
  return prisma.slackPendingDmDecision.create({ data })
}

export function findPendingDmDecision(
  decisionId: string,
): Promise<SlackPendingDmDecisionRecord | null> {
  return prisma.slackPendingDmDecision.findUnique({ where: { id: decisionId } })
}

export async function markPendingDmDecisionContinued(
  decisionId: string,
): Promise<boolean> {
  const result = await prisma.slackPendingDmDecision.updateMany({
    where: {
      expiresAt: { gt: new Date() },
      id: decisionId,
      status: 'pending',
    },
    data: { status: 'continued' },
  })

  return result.count === 1
}

export async function markPendingDmDecisionStartedNew(
  decisionId: string,
  _newSessionId: string,
): Promise<boolean> {
  const result = await prisma.slackPendingDmDecision.updateMany({
    where: {
      expiresAt: { gt: new Date() },
      id: decisionId,
      status: 'pending',
    },
    data: { status: 'started_new' },
  })

  return result.count === 1
}

export async function expirePendingDmDecision(decisionId: string): Promise<void> {
  await prisma.slackPendingDmDecision.updateMany({
    where: {
      id: decisionId,
      status: 'pending',
    },
    data: { status: 'expired' },
  })
}

export async function upsertNotificationChannelsFromSlack(
  slackTeamId: string,
  channels: Array<{ channelId: string; name: string; isPrivate: boolean }>,
): Promise<void> {
  for (const channel of channels) {
    await prisma.slackNotificationChannel.upsert({
      where: {
        slackTeamId_channelId: {
          channelId: channel.channelId,
          slackTeamId,
        },
      },
      create: {
        channelId: channel.channelId,
        enabled: true,
        isPrivate: channel.isPrivate,
        name: channel.name,
        slackTeamId,
      },
      update: {
        isPrivate: channel.isPrivate,
        name: channel.name,
      },
    })
  }
}

export function listNotificationChannels(
  slackTeamId: string,
): Promise<SlackNotificationChannelRecord[]> {
  return prisma.slackNotificationChannel.findMany({
    where: { slackTeamId },
    orderBy: [
      { isPrivate: 'asc' },
      { name: 'asc' },
    ],
  })
}

export function listEnabledNotificationChannels(
  slackTeamId: string,
): Promise<SlackNotificationChannelRecord[]> {
  return prisma.slackNotificationChannel.findMany({
    where: {
      enabled: true,
      slackTeamId,
    },
    orderBy: [
      { isPrivate: 'asc' },
      { name: 'asc' },
    ],
  })
}

export async function setNotificationChannelEnabled(
  channelId: string,
  enabled: boolean,
): Promise<void> {
  await prisma.slackNotificationChannel.updateMany({
    where: {
      OR: [
        { id: channelId },
        { channelId },
      ],
    },
    data: { enabled },
  })
}

export async function isNotificationChannelAllowed(
  slackTeamId: string,
  channelId: string,
): Promise<boolean> {
  const channel = await prisma.slackNotificationChannel.findFirst({
    where: {
      channelId,
      enabled: true,
      slackTeamId,
    },
    select: { id: true },
  })

  return Boolean(channel)
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

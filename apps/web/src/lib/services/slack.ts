import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export const SLACK_INTEGRATION_SINGLETON_KEY = 'default'

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

export function findIntegration(): Promise<SlackIntegrationRecord | null> {
  return prisma.slackIntegration.findUnique({
    where: { singletonKey: SLACK_INTEGRATION_SINGLETON_KEY },
  })
}

export function saveIntegrationConfig(args: {
  enabled: boolean
  botTokenSecret?: string | null
  appTokenSecret?: string | null
  slackTeamId?: string | null
  slackAppId?: string | null
  slackBotUserId?: string | null
  defaultAgentId?: string | null
  clearLastError?: boolean
}): Promise<SlackIntegrationRecord> {
  const updateData: Prisma.SlackIntegrationUpdateInput = {
    enabled: args.enabled,
    version: { increment: 1 },
  }

  if (args.botTokenSecret !== undefined) {
    updateData.botTokenSecret = args.botTokenSecret
  }
  if (args.appTokenSecret !== undefined) {
    updateData.appTokenSecret = args.appTokenSecret
  }
  if (args.slackTeamId !== undefined) {
    updateData.slackTeamId = args.slackTeamId
  }
  if (args.slackAppId !== undefined) {
    updateData.slackAppId = args.slackAppId
  }
  if (args.slackBotUserId !== undefined) {
    updateData.slackBotUserId = args.slackBotUserId
  }
  if (args.defaultAgentId !== undefined) {
    updateData.defaultAgentId = args.defaultAgentId
  }
  if (args.clearLastError) {
    updateData.lastError = null
  }

  return prisma.slackIntegration.upsert({
    where: { singletonKey: SLACK_INTEGRATION_SINGLETON_KEY },
    create: {
      singletonKey: SLACK_INTEGRATION_SINGLETON_KEY,
      enabled: args.enabled,
      botTokenSecret: args.botTokenSecret ?? null,
      appTokenSecret: args.appTokenSecret ?? null,
      slackTeamId: args.slackTeamId ?? null,
      slackAppId: args.slackAppId ?? null,
      slackBotUserId: args.slackBotUserId ?? null,
      defaultAgentId: args.defaultAgentId ?? null,
      lastError: args.clearLastError ? null : undefined,
    },
    update: updateData,
  })
}

export function clearIntegration(): Promise<SlackIntegrationRecord> {
  return prisma.slackIntegration.upsert({
    where: { singletonKey: SLACK_INTEGRATION_SINGLETON_KEY },
    create: {
      singletonKey: SLACK_INTEGRATION_SINGLETON_KEY,
      enabled: false,
      botTokenSecret: null,
      appTokenSecret: null,
      slackTeamId: null,
      slackAppId: null,
      slackBotUserId: null,
      defaultAgentId: null,
      lastError: null,
    },
    update: {
      enabled: false,
      botTokenSecret: null,
      appTokenSecret: null,
      slackTeamId: null,
      slackAppId: null,
      slackBotUserId: null,
      defaultAgentId: null,
      lastError: null,
      lastSocketConnectedAt: null,
      lastEventAt: null,
      version: { increment: 1 },
    },
  })
}

export function markSocketConnected(connectedAt: Date) {
  return prisma.slackIntegration.updateMany({
    where: { singletonKey: SLACK_INTEGRATION_SINGLETON_KEY },
    data: {
      lastSocketConnectedAt: connectedAt,
      lastError: null,
    },
  })
}

export function markEventReceived(receivedAt: Date) {
  return prisma.slackIntegration.updateMany({
    where: { singletonKey: SLACK_INTEGRATION_SINGLETON_KEY },
    data: { lastEventAt: receivedAt },
  })
}

export function markLastError(lastError: string | null) {
  return prisma.slackIntegration.updateMany({
    where: { singletonKey: SLACK_INTEGRATION_SINGLETON_KEY },
    data: { lastError },
  })
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

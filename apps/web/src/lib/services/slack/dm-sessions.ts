import { prisma } from '@/lib/prisma'
import { createSlackAuditEvent } from '@/lib/services/slack/audit'
import type {
  SlackDmSessionBindingRecord,
  SlackPendingDmDecisionRecord,
} from '@/lib/services/slack/records'

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
    data: { messageText: '', status: 'continued' },
  })

  return result.count === 1
}

export async function markPendingDmDecisionStartedNew(
  decisionId: string,
): Promise<boolean> {
  const result = await prisma.slackPendingDmDecision.updateMany({
    where: {
      expiresAt: { gt: new Date() },
      id: decisionId,
      status: 'pending',
    },
    data: { messageText: '', status: 'started_new' },
  })

  return result.count === 1
}

export async function expirePendingDmDecision(decisionId: string): Promise<void> {
  await prisma.slackPendingDmDecision.updateMany({
    where: {
      id: decisionId,
      status: 'pending',
    },
    data: { messageText: '', status: 'expired' },
  })
}

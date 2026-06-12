import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isDesktop } from '@/lib/runtime/mode'
import type {
  LearningEvidence,
  LearningProposal,
  LearningProposalOperation,
  LearningProposalType,
  LearningRun,
  LearningRunStatus,
  LearningTrigger,
} from '@/types/learning'

export type ProposalInput = {
  runId?: string | null
  title: string
  type?: LearningProposalType
  confidence: number
  evidence: LearningEvidence
  kbPath: string
  operation: LearningProposalOperation
  proposedContent: string
  currentFileHash?: string | null
  internalSessionId?: string | null
  trigger: LearningTrigger
}

function toIso(date: Date): string {
  return date.toISOString()
}

export function mapRun(run: {
  id: string
  sourceSessionId: string | null
  internalSessionId: string | null
  title: string
  trigger: LearningTrigger
  status: LearningRunStatus
  error: string | null
  messageCount: number
  createdAt: Date
  updatedAt: Date
}): LearningRun {
  return {
    id: run.id,
    sourceSessionId: run.sourceSessionId,
    internalSessionId: run.internalSessionId,
    title: run.title,
    trigger: run.trigger,
    status: run.status,
    error: run.error,
    messageCount: run.messageCount,
    createdAt: toIso(run.createdAt),
    updatedAt: toIso(run.updatedAt),
  }
}

export function parseEvidence(value: Prisma.JsonValue | string): LearningEvidence {
  if (typeof value === 'string') {
    try {
      return parseEvidence(JSON.parse(value) as Prisma.JsonValue)
    } catch {
      return {}
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return {
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
    messageId: typeof value.messageId === 'string' ? value.messageId : undefined,
    quote: typeof value.quote === 'string' ? value.quote : undefined,
    source: typeof value.source === 'string' ? value.source : undefined,
  }
}

export function mapProposal(proposal: {
  id: string
  runId: string | null
  status: 'pending' | 'rejected' | 'applied'
  title: string
  type: LearningProposalType
  confidence: number
  evidence: Prisma.JsonValue
  kbPath: string
  operation: LearningProposalOperation
  proposedContent: string
  currentFileHash: string | null
  internalSessionId: string | null
  trigger: LearningTrigger
  createdAt: Date
  updatedAt: Date
}): LearningProposal {
  return {
    id: proposal.id,
    runId: proposal.runId,
    status: proposal.status,
    title: proposal.title,
    type: proposal.type,
    confidence: proposal.confidence,
    evidence: parseEvidence(proposal.evidence),
    kbPath: proposal.kbPath,
    operation: proposal.operation,
    proposedContent: proposal.proposedContent,
    currentFileHash: proposal.currentFileHash,
    internalSessionId: proposal.internalSessionId,
    trigger: proposal.trigger,
    createdAt: toIso(proposal.createdAt),
    updatedAt: toIso(proposal.updatedAt),
  }
}

export async function listLearningRuns(userId: string): Promise<LearningRun[]> {
  const runs = await prisma.knowledgeLearningRun.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return runs.map(mapRun)
}

export async function listLearningProposals(userId: string): Promise<LearningProposal[]> {
  const proposals = await prisma.knowledgeLearningProposal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return proposals.map(mapProposal)
}

export async function createLearningRunRecord(args: {
  userId: string
  sourceSessionId?: string | null
  internalSessionId?: string | null
  title: string
  trigger: LearningTrigger
}): Promise<LearningRun> {
  const run = await prisma.knowledgeLearningRun.create({
    data: {
      userId: args.userId,
      sourceSessionId: args.sourceSessionId ?? null,
      internalSessionId: args.internalSessionId ?? null,
      title: args.title,
      trigger: args.trigger,
      status: 'pending',
    },
  })

  return mapRun(run)
}

export async function setLearningRunMessageCount(args: { runId: string; messageCount: number }): Promise<void> {
  await prisma.knowledgeLearningRun.update({
    where: { id: args.runId },
    data: { messageCount: args.messageCount },
  })
}

export async function setLearningRunInternalSessionId(args: {
  runId: string
  internalSessionId: string
}): Promise<void> {
  await prisma.knowledgeLearningRun.update({
    where: { id: args.runId },
    data: { internalSessionId: args.internalSessionId },
  })
}

export async function findLearningRunForUser(args: {
  runId: string
  userId: string
}): Promise<LearningRun | null> {
  const run = await prisma.knowledgeLearningRun.findFirst({
    where: { id: args.runId, userId: args.userId },
  })
  return run ? mapRun(run) : null
}

export async function claimLearningRunForExecution(runId: string): Promise<boolean> {
  // Atomic pending/failed -> running transition so concurrent dispatches
  // (create + manual retry) cannot execute the same run twice.
  const result = await prisma.knowledgeLearningRun.updateMany({
    where: { id: runId, status: { in: ['pending', 'failed'] } },
    data: { status: 'running', error: null, finishedAt: null, startedAt: new Date() },
  })
  return result.count === 1
}

export async function cancelLearningRun(args: {
  runId: string
  userId: string
}): Promise<LearningRun | null> {
  const result = await prisma.knowledgeLearningRun.updateMany({
    where: { id: args.runId, userId: args.userId, status: { in: ['pending', 'running'] } },
    data: { error: null, finishedAt: new Date(), status: 'cancelled' },
  })
  if (result.count !== 1) return null

  const updated = await prisma.knowledgeLearningRun.findFirst({
    where: { id: args.runId, userId: args.userId },
  })
  return updated ? mapRun(updated) : null
}

export async function hasActiveLearningRun(args: {
  userId: string
  sessionId: string
  pendingSince: Date
}): Promise<boolean> {
  const activeRun = await prisma.knowledgeLearningRun.findFirst({
    where: {
      userId: args.userId,
      sourceSessionId: args.sessionId,
      OR: [
        { status: 'running' },
        // Pending runs older than the staleness window no longer block new runs.
        { status: 'pending', createdAt: { gte: args.pendingSince } },
      ],
    },
  })
  return Boolean(activeRun)
}

export async function learningRunBelongsToUser(args: { userId: string; runId: string }): Promise<boolean> {
  const run = await prisma.knowledgeLearningRun.findFirst({
    where: { id: args.runId, userId: args.userId },
    select: { id: true },
  })
  return Boolean(run)
}

export async function hasRecentLearningRun(args: { userId: string; sessionId: string; since: Date }): Promise<boolean> {
  const recentRun = await prisma.knowledgeLearningRun.findFirst({
    where: {
      userId: args.userId,
      sourceSessionId: args.sessionId,
      createdAt: { gte: args.since },
    },
  })
  return Boolean(recentRun)
}

export async function findPendingLearningProposal(args: { userId: string; proposalId: string }) {
  return prisma.knowledgeLearningProposal.findFirst({
    where: { id: args.proposalId, userId: args.userId },
  })
}

export async function updatePendingLearningProposalRejected(args: {
  proposalId: string
  userId: string
}): Promise<LearningProposal | null> {
  const result = await prisma.knowledgeLearningProposal.updateMany({
    where: { id: args.proposalId, userId: args.userId, status: 'pending' },
    data: { status: 'rejected', rejectedAt: new Date() },
  })
  if (result.count !== 1) return null

  const updated = await prisma.knowledgeLearningProposal.findUnique({ where: { id: args.proposalId } })
  if (!updated) return null

  return mapProposal(updated)
}

export async function updatePendingLearningProposalApplied(args: {
  proposalId: string
  userId: string
  content: string
}): Promise<LearningProposal | null> {
  const result = await prisma.knowledgeLearningProposal.updateMany({
    where: { id: args.proposalId, userId: args.userId, status: 'pending' },
    data: { status: 'applied', appliedAt: new Date(), proposedContent: args.content },
  })
  if (result.count !== 1) return null

  const updated = await prisma.knowledgeLearningProposal.findUnique({ where: { id: args.proposalId } })
  if (!updated) return null

  return mapProposal(updated)
}

function serializeEvidenceForStorage(evidence: LearningEvidence): Prisma.InputJsonValue {
  return isDesktop() ? JSON.stringify(evidence) : evidence
}

export async function createLearningProposal(userId: string, input: ProposalInput): Promise<LearningProposal> {
  const proposal = await prisma.knowledgeLearningProposal.create({
    data: {
      userId,
      runId: input.runId ?? null,
      title: input.title,
      type: input.type ?? 'other',
      confidence: input.confidence,
      evidence: serializeEvidenceForStorage(input.evidence),
      kbPath: input.kbPath,
      operation: input.operation,
      proposedContent: input.proposedContent,
      currentFileHash: input.currentFileHash ?? null,
      internalSessionId: input.internalSessionId ?? null,
      trigger: input.trigger,
    },
  })
  return mapProposal(proposal)
}

export async function markLearningRunRunning(runId: string): Promise<void> {
  await prisma.knowledgeLearningRun.update({
    where: { id: runId },
    data: { error: null, finishedAt: null, startedAt: new Date(), status: 'running' },
  })
}

export async function markLearningRunSucceeded(runId: string): Promise<void> {
  await prisma.knowledgeLearningRun.updateMany({
    where: { id: runId, status: 'running' },
    data: { finishedAt: new Date(), status: 'succeeded' },
  })
}

export async function markLearningRunFailed(args: { runId: string; error: string }): Promise<void> {
  await prisma.knowledgeLearningRun.updateMany({
    where: { id: args.runId, status: 'running' },
    data: { error: args.error, finishedAt: new Date(), status: 'failed' },
  })
}

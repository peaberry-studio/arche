import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isDesktop } from '@/lib/runtime/mode'
import type {
  KnowledgeReviewAuditEntry,
  KnowledgeReviewChange,
  KnowledgeReviewChangeStatus,
  KnowledgeReviewOperation,
  LearningEvidence,
  LearningRun,
  LearningRunStatus,
  LearningTrigger,
} from '@/types/learning'

export type KnowledgeReviewChangeInput = {
  agent?: string | null
  author: string
  baseContent?: string | null
  baseHash?: string | null
  confidence: number
  evidence: LearningEvidence
  initialStatus?: Extract<KnowledgeReviewChangeStatus, 'open' | 'needs_rebase'>
  kbPath: string
  operation: KnowledgeReviewOperation
  origin: string
  proposedContent: string
  reason: string
  regeneratedFromId?: string | null
  runId?: string | null
  sourceProposalId?: string | null
  title: string
}

function toIso(date: Date): string {
  return date.toISOString()
}

export function mapRun(run: {
  id: string
  sourceSessionId: string | null
  internalSessionId: string | null
  regenerationChangeId: string | null
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
    regenerationChangeId: run.regenerationChangeId,
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

function parseAuditTrail(value: Prisma.JsonValue | string): KnowledgeReviewAuditEntry[] {
  if (typeof value === 'string') {
    try {
      return parseAuditTrail(JSON.parse(value) as Prisma.JsonValue)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    if (typeof entry.action !== 'string' || typeof entry.actor !== 'string' || typeof entry.at !== 'string') return []
    return [{
      action: entry.action,
      actor: entry.actor,
      at: entry.at,
      ...(typeof entry.hash === 'string' ? { hash: entry.hash } : {}),
    }]
  })
}

export function mapKnowledgeReviewChange(change: {
  id: string
  sourceProposalId: string | null
  regeneratedFromId: string | null
  runId: string | null
  author: string
  agent: string | null
  origin: string
  title: string
  reason: string
  evidence: Prisma.JsonValue
  confidence: number
  kbPath: string
  operation: KnowledgeReviewOperation
  baseContent: string | null
  baseHash: string | null
  proposedContent: string
  status: KnowledgeReviewChangeStatus
  actualContent: string | null
  actualHash: string | null
  appliedHash: string | null
  publishCommitSha: string | null
  auditTrail: Prisma.JsonValue
  createdAt: Date
  updatedAt: Date
}): KnowledgeReviewChange {
  // A crashed apply leaves a record reserved as `applying` with no mutation
  // finalized. From every read path it is a proposal whose base is stale, so
  // surface it as needs_rebase for the user to rebase, regenerate, or reject.
  const status: KnowledgeReviewChangeStatus = change.status === 'applying' ? 'needs_rebase' : change.status
  return {
    id: change.id,
    sourceProposalId: change.sourceProposalId,
    regeneratedFromId: change.regeneratedFromId,
    runId: change.runId,
    author: change.author,
    agent: change.agent,
    origin: change.origin,
    title: change.title,
    reason: change.reason,
    evidence: parseEvidence(change.evidence),
    confidence: change.confidence,
    kbPath: change.kbPath,
    operation: change.operation,
    baseContent: change.baseContent,
    baseHash: change.baseHash,
    proposedContent: change.proposedContent,
    status,
    actualContent: change.actualContent,
    actualHash: change.actualHash,
    appliedHash: change.appliedHash,
    publishCommitSha: change.publishCommitSha,
    auditTrail: parseAuditTrail(change.auditTrail),
    createdAt: toIso(change.createdAt),
    updatedAt: toIso(change.updatedAt),
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



export async function listKnowledgeReviewChanges(userId: string): Promise<KnowledgeReviewChange[]> {
  const changes = await prisma.knowledgeReviewChange.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return changes.map(mapKnowledgeReviewChange)
}

export async function createLearningRunRecord(args: {
  userId: string
  sourceSessionId?: string | null
  internalSessionId?: string | null
  regenerationChangeId?: string | null
  title: string
  trigger: LearningTrigger
}): Promise<LearningRun> {
  const run = await prisma.knowledgeLearningRun.create({
    data: {
      userId: args.userId,
      sourceSessionId: args.sourceSessionId ?? null,
      internalSessionId: args.internalSessionId ?? null,
      regenerationChangeId: args.regenerationChangeId ?? null,
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



export async function findKnowledgeReviewChange(args: {
  changeId: string
  userId: string
}): Promise<KnowledgeReviewChange | null> {
  const change = await prisma.knowledgeReviewChange.findFirst({
    where: { id: args.changeId, userId: args.userId },
  })
  return change ? mapKnowledgeReviewChange(change) : null
}

function serializeEvidenceForStorage(evidence: LearningEvidence): Prisma.InputJsonValue {
  return isDesktop() ? JSON.stringify(evidence) : evidence
}

function serializeAuditTrailForStorage(entries: KnowledgeReviewAuditEntry[]): Prisma.InputJsonValue {
  return isDesktop() ? JSON.stringify(entries) : entries
}

// Actions repeated by autosave rather than by a user decision. Appending one
// entry per save would grow the audit JSON without bound over a proposal's
// lifetime, so a run of them by the same actor collapses into its latest entry.
const COALESCED_AUDIT_ACTIONS = new Set(['draft_saved'])

function withAuditEntry(entries: KnowledgeReviewAuditEntry[], args: {
  action: string
  actor: string
  hash?: string
}): KnowledgeReviewAuditEntry[] {
  const entry: KnowledgeReviewAuditEntry = {
    action: args.action,
    actor: args.actor,
    at: new Date().toISOString(),
    ...(args.hash ? { hash: args.hash } : {}),
  }

  const previous = entries[entries.length - 1]
  if (
    previous &&
    COALESCED_AUDIT_ACTIONS.has(args.action) &&
    previous.action === args.action &&
    previous.actor === args.actor
  ) {
    return [...entries.slice(0, -1), entry]
  }

  return [...entries, entry]
}

export async function createKnowledgeReviewChange(
  userId: string,
  input: KnowledgeReviewChangeInput,
): Promise<{ ok: true; change: KnowledgeReviewChange } | { ok: false; error: string }> {
  try {
    const change = await prisma.$transaction(async (transaction) => {
      const supersededWhere: Prisma.KnowledgeReviewChangeWhereInput = {
        userId,
        kbPath: input.kbPath,
        status: { in: ['open', 'needs_rebase', 'applying'] },
        ...(input.regeneratedFromId ? { id: { not: input.regeneratedFromId } } : {}),
      }
      await transaction.knowledgeReviewChange.updateMany({
        where: supersededWhere,
        data: { status: 'superseded' },
      })

      const created = await transaction.knowledgeReviewChange.create({
        data: {
          userId,
          sourceProposalId: input.sourceProposalId ?? null,
          regeneratedFromId: input.regeneratedFromId ?? null,
          runId: input.runId ?? null,
          author: input.author,
          agent: input.agent ?? null,
          origin: input.origin,
          title: input.title,
          reason: input.reason,
          evidence: serializeEvidenceForStorage(input.evidence),
          confidence: input.confidence,
          kbPath: input.kbPath,
          operation: input.operation,
          baseContent: input.baseContent ?? null,
          baseHash: input.baseHash ?? null,
          proposedContent: input.proposedContent,
          status: input.initialStatus ?? 'open',
          auditTrail: serializeAuditTrailForStorage(withAuditEntry([], {
            action: 'created',
            actor: input.author,
            hash: input.baseHash ?? undefined,
          })),
        },
      })
      if (!input.regeneratedFromId) return created

      const original = await transaction.knowledgeReviewChange.findFirst({
        where: { id: input.regeneratedFromId, userId },
      })
      if (!original || (original.status !== 'needs_rebase' && original.status !== 'applying')) {
        throw new Error('regeneration_source_not_rebaseable')
      }
      const superseded = await transaction.knowledgeReviewChange.updateMany({
        where: { id: original.id, userId, status: { in: ['needs_rebase', 'applying'] } },
        data: {
          status: 'superseded',
          auditTrail: serializeAuditTrailForStorage(withAuditEntry(parseAuditTrail(original.auditTrail), {
            action: 'regenerated',
            actor: input.author,
          })),
        },
      })
      if (superseded.count !== 1) throw new Error('regeneration_source_not_rebaseable')
      return created
    })

    return { ok: true, change: mapKnowledgeReviewChange(change) }
  } catch (error) {
    if (error instanceof Error && error.message === 'regeneration_source_not_rebaseable') {
      return { ok: false, error: 'regeneration_source_not_rebaseable' }
    }
    throw error
  }
}

async function transitionKnowledgeReviewChange(args: {
  action: string
  actor: string
  allowedStatuses: KnowledgeReviewChangeStatus[]
  changeId: string
  data: Prisma.KnowledgeReviewChangeUpdateManyMutationInput
  hash?: string
  userId: string
}): Promise<KnowledgeReviewChange | null> {
  const current = await prisma.knowledgeReviewChange.findFirst({
    where: { id: args.changeId, userId: args.userId },
  })
  if (!current || !args.allowedStatuses.includes(current.status)) return null

  const result = await prisma.knowledgeReviewChange.updateMany({
    where: {
      id: args.changeId,
      userId: args.userId,
      status: { in: args.allowedStatuses },
      // The audit trail is read here and written back whole, so the row must not
      // have moved since. The status guard alone misses transitions that leave
      // the status untouched (a draft save is `open -> open`), which let a stale
      // writer overwrite a newer one and drop its audit entry.
      updatedAt: current.updatedAt,
    },
    data: {
      ...args.data,
      auditTrail: serializeAuditTrailForStorage(withAuditEntry(parseAuditTrail(current.auditTrail), {
        action: args.action,
        actor: args.actor,
        hash: args.hash,
      })),
    },
  })
  if (result.count !== 1) return null

  const updated = await prisma.knowledgeReviewChange.findUnique({ where: { id: args.changeId } })
  return updated ? mapKnowledgeReviewChange(updated) : null
}

export async function startLearningRunForKnowledgeReviewRegeneration(args: {
  actor: string
  changeId: string
  userId: string
  title: string
}): Promise<LearningRun | null> {
  try {
    const run = await prisma.$transaction(async (transaction) => {
      const change = await transaction.knowledgeReviewChange.findFirst({
        where: { id: args.changeId, userId: args.userId },
      })
      if (!change || (change.status !== 'needs_rebase' && change.status !== 'applying')) return null

      const updated = await transaction.knowledgeReviewChange.updateMany({
        // Read Committed does not make the read-modify-write above atomic, so the
        // row is guarded on the snapshot it was read from, same as
        // transitionKnowledgeReviewChange.
        where: {
          id: change.id,
          userId: args.userId,
          status: { in: ['needs_rebase', 'applying'] },
          updatedAt: change.updatedAt,
        },
        data: {
          auditTrail: serializeAuditTrailForStorage(withAuditEntry(parseAuditTrail(change.auditTrail), {
            action: 'regeneration_requested',
            actor: args.actor,
          })),
        },
      })
      if (updated.count !== 1) throw new Error('regeneration_source_not_rebaseable')

      return transaction.knowledgeLearningRun.create({
        data: {
          userId: args.userId,
          sourceSessionId: null,
          internalSessionId: null,
          regenerationChangeId: change.id,
          title: args.title,
          trigger: 'manual',
          status: 'pending',
        },
      })
    })
    return run ? mapRun(run) : null
  } catch (error) {
    if (error instanceof Error && error.message === 'regeneration_source_not_rebaseable') {
      return null
    }
    throw error
  }
}

export async function saveKnowledgeReviewDraft(args: {
  actor: string
  changeId: string
  content: string
  userId: string
}): Promise<KnowledgeReviewChange | null> {
  return transitionKnowledgeReviewChange({
    action: 'draft_saved',
    actor: args.actor,
    allowedStatuses: ['open', 'needs_rebase'],
    changeId: args.changeId,
    data: { proposedContent: args.content },
    userId: args.userId,
  })
}

export async function markKnowledgeReviewChangeNeedsRebase(args: {
  actualContent: string | null
  actualHash: string | null
  actor: string
  changeId: string
  userId: string
}): Promise<KnowledgeReviewChange | null> {
  return transitionKnowledgeReviewChange({
    action: 'needs_rebase',
    actor: args.actor,
    allowedStatuses: ['open', 'needs_rebase', 'applying'],
    changeId: args.changeId,
    data: {
      status: 'needs_rebase',
      actualContent: args.actualContent,
      actualHash: args.actualHash,
    },
    hash: args.actualHash ?? undefined,
    userId: args.userId,
  })
}

// Atomically claims an open change before its KB mutation so a concurrent
// Reject (or second Apply) cannot win after the file was already changed.
// The record is finalized with markKnowledgeReviewChangeApplied or rolled
// back to needs_rebase if the mutation fails.
export async function markKnowledgeReviewChangeApplying(args: {
  actor: string
  actualContent: string | null
  actualHash: string | null
  changeId: string
  content: string
  userId: string
}): Promise<KnowledgeReviewChange | null> {
  return transitionKnowledgeReviewChange({
    action: 'apply_started',
    actor: args.actor,
    allowedStatuses: ['open'],
    changeId: args.changeId,
    data: {
      status: 'applying',
      appliedAt: new Date(),
      actualContent: args.actualContent,
      actualHash: args.actualHash,
      proposedContent: args.content,
    },
    hash: args.actualHash ?? undefined,
    userId: args.userId,
  })
}

export async function rebaseKnowledgeReviewChange(args: {
  actor: string
  changeId: string
  userId: string
}): Promise<KnowledgeReviewChange | null> {
  const change = await findKnowledgeReviewChange({ changeId: args.changeId, userId: args.userId })
  if (!change || change.status !== 'needs_rebase' || !change.actualHash) return null

  return transitionKnowledgeReviewChange({
    action: 'rebased',
    actor: args.actor,
    allowedStatuses: ['needs_rebase', 'applying'],
    changeId: args.changeId,
    data: {
      status: 'open',
      baseContent: change.actualContent,
      baseHash: change.actualHash,
      actualContent: null,
      actualHash: null,
    },
    hash: change.actualHash,
    userId: args.userId,
  })
}

export async function markKnowledgeReviewChangeApplied(args: {
  actor: string
  appliedHash: string
  changeId: string
  content: string
  userId: string
}): Promise<KnowledgeReviewChange | null> {
  return transitionKnowledgeReviewChange({
    action: 'applied',
    actor: args.actor,
    allowedStatuses: ['applying'],
    changeId: args.changeId,
    data: {
      status: 'applied',
      appliedAt: new Date(),
      appliedHash: args.appliedHash,
      proposedContent: args.content,
    },
    hash: args.appliedHash,
    userId: args.userId,
  })
}

export async function rejectKnowledgeReviewChange(args: {
  actor: string
  changeId: string
  userId: string
}): Promise<KnowledgeReviewChange | null> {
  return transitionKnowledgeReviewChange({
    action: 'rejected',
    actor: args.actor,
    allowedStatuses: ['open', 'needs_rebase'],
    changeId: args.changeId,
    data: { status: 'rejected', rejectedAt: new Date() },
    userId: args.userId,
  })
}

export async function listAppliedKnowledgeReviewChanges(args: {
  paths: string[]
  userId: string
}): Promise<KnowledgeReviewChange[]> {
  if (args.paths.length === 0) return []
  const changes = await prisma.knowledgeReviewChange.findMany({
    where: {
      userId: args.userId,
      status: 'applied',
      kbPath: { in: args.paths },
    },
  })
  return changes.map(mapKnowledgeReviewChange)
}

export async function markKnowledgeReviewChangesPublished(args: {
  actor: string
  commitSha: string
  paths: string[]
  userId: string
}): Promise<KnowledgeReviewChange[]> {
  const changes = await listAppliedKnowledgeReviewChanges({ paths: args.paths, userId: args.userId })
  const published = await Promise.all(changes.map((change) => transitionKnowledgeReviewChange({
    action: 'published',
    actor: args.actor,
    allowedStatuses: ['applied'],
    changeId: change.id,
    data: {
      status: 'published',
      publishCommitSha: args.commitSha,
      publishedAt: new Date(),
    },
    hash: args.commitSha,
    userId: args.userId,
  })))
  return published.filter((change): change is KnowledgeReviewChange => change !== null)
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

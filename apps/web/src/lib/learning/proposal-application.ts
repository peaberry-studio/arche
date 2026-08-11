import { auditEvent } from '@/lib/auth'
import {
  findKnowledgeReviewChange,
  findPendingLearningProposal,
  markKnowledgeReviewChangeApplied,
  markKnowledgeReviewChangeNeedsRebase,
  rebaseKnowledgeReviewChange,
  rejectKnowledgeReviewChange,
  saveKnowledgeReviewDraft,
  startLearningRunForKnowledgeReviewRegeneration,
  updatePendingLearningProposalApplied,
  updatePendingLearningProposalRejected,
} from '@/lib/learning/repository'
import { dispatchLearningRunExecution } from '@/lib/learning/run-executor'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'
import { workspaceAgentFetch } from '@/lib/workspace-agent-client'
import type {
  KnowledgeReviewChange,
  KnowledgeReviewOperation,
  KnowledgeReviewRegenerationContext,
  LearningProposal,
  LearningRun,
} from '@/types/learning'

type FileReadResponse = {
  ok: boolean
  path: string
  content: string
  encoding: string
  hash: string
}

type FileWriteResponse = {
  ok: boolean
  path: string
  hash: string
}

type FileDeleteResponse = {
  ok: boolean
  path: string
  deleted: boolean
}

export type KnowledgeReviewBaseCapture = {
  baseContent: string | null
  baseHash: string | null
  initialStatus: 'open' | 'needs_rebase'
}

export async function captureKnowledgeReviewBase(args: {
  kbPath: string
  operation: KnowledgeReviewOperation
  slug: string
}): Promise<{ ok: true; data: KnowledgeReviewBaseCapture } | { ok: false; error: string }> {
  const agent = await createWorkspaceAgentClient(args.slug)
  if (!agent) return { ok: false, error: 'workspace_agent_unavailable' }

  const read = await workspaceAgentFetch<FileReadResponse>(agent, '/files/read', { path: args.kbPath })
  if (args.operation === 'create') {
    if (read.ok) return { ok: false, error: 'file_exists' }
    if (read.status !== 404) return { ok: false, error: read.error }
    return { ok: true, data: { baseContent: null, baseHash: null, initialStatus: 'open' } }
  }

  if (!read.ok) {
    if (read.status === 404) {
      return { ok: true, data: { baseContent: null, baseHash: null, initialStatus: 'needs_rebase' } }
    }
    return { ok: false, error: read.error }
  }

  return {
    ok: true,
    data: {
      baseContent: read.data.content,
      baseHash: read.data.hash,
      initialStatus: 'open',
    },
  }
}

async function captureCurrentKnowledgeReviewFile(args: {
  agent: { baseUrl: string; authHeader: string }
  kbPath: string
}): Promise<{ content: string | null; hash: string | null }> {
  const read = await workspaceAgentFetch<FileReadResponse>(args.agent, '/files/read', { path: args.kbPath })
  return read.ok ? { content: read.data.content, hash: read.data.hash } : { content: null, hash: null }
}

export async function rejectLearningProposal(args: {
  userId: string
  proposalId: string
}): Promise<{ ok: true; proposal: LearningProposal } | { ok: false; error: string }> {
  const proposal = await findPendingLearningProposal({ proposalId: args.proposalId, userId: args.userId })
  if (!proposal) return { ok: false, error: 'not_found' }
  if (proposal.status !== 'pending') return { ok: false, error: 'not_pending' }

  const updated = await updatePendingLearningProposalRejected({ proposalId: proposal.id, userId: args.userId })
  if (!updated) return { ok: false, error: 'not_pending' }

  await auditEvent({ actorUserId: args.userId, action: 'learning.proposal_rejected', metadata: { proposalId: proposal.id } })
  return { ok: true, proposal: updated }
}

export async function applyLearningProposal(args: {
  userId: string
  slug: string
  proposalId: string
  content?: string
}): Promise<{ ok: true; proposal: LearningProposal } | { ok: false; error: string }> {
  const proposal = await findPendingLearningProposal({ proposalId: args.proposalId, userId: args.userId })
  if (!proposal) return { ok: false, error: 'not_found' }
  if (proposal.status !== 'pending') return { ok: false, error: 'not_pending' }

  const agent = await createWorkspaceAgentClient(args.slug)
  if (!agent) return { ok: false, error: 'workspace_agent_unavailable' }

  const read = await workspaceAgentFetch<FileReadResponse>(agent, '/files/read', { path: proposal.kbPath })
  if (proposal.operation === 'create') {
    if (read.ok) return { ok: false, error: 'file_exists' }
    if (read.status !== 404) return { ok: false, error: read.error }
  } else {
    if (!read.ok) return { ok: false, error: read.error }
    if (proposal.currentFileHash && read.data.hash !== proposal.currentFileHash) {
      return { ok: false, error: 'hash_conflict' }
    }
  }

  const expectedHash = proposal.operation === 'create' ? '' : read.ok ? read.data.hash : ''
  const content = args.content ?? proposal.proposedContent
  const write = await workspaceAgentFetch<FileWriteResponse>(agent, '/files/write', {
    path: proposal.kbPath,
    content,
    encoding: 'utf-8',
    expectedHash,
  })
  if (!write.ok) return { ok: false, error: write.error }

  const updated = await updatePendingLearningProposalApplied({ proposalId: proposal.id, userId: args.userId, content })
  if (!updated) return { ok: false, error: 'not_pending' }

  await auditEvent({
    actorUserId: args.userId,
    action: 'learning.proposal_applied',
    metadata: { proposalId: proposal.id, kbPath: proposal.kbPath },
  })
  return { ok: true, proposal: updated }
}

export async function saveKnowledgeReviewChangeDraft(args: {
  actor: string
  changeId: string
  content: string
  userId: string
}): Promise<{ ok: true; change: KnowledgeReviewChange } | { ok: false; error: string }> {
  const change = await saveKnowledgeReviewDraft(args)
  if (!change) return { ok: false, error: 'not_open' }

  await auditEvent({
    actorUserId: args.userId,
    action: 'knowledge.review_draft_saved',
    metadata: { changeId: change.id, kbPath: change.kbPath },
  })
  return { ok: true, change }
}

export async function rejectKnowledgeReviewChangeForUser(args: {
  actor: string
  changeId: string
  userId: string
}): Promise<{ ok: true; change: KnowledgeReviewChange } | { ok: false; error: string }> {
  const change = await rejectKnowledgeReviewChange(args)
  if (!change) return { ok: false, error: 'not_open' }

  await auditEvent({
    actorUserId: args.userId,
    action: 'knowledge.review_rejected',
    metadata: { changeId: change.id, kbPath: change.kbPath },
  })
  return { ok: true, change }
}

export async function rebaseKnowledgeReviewChangeForUser(args: {
  actor: string
  changeId: string
  userId: string
}): Promise<{ ok: true; change: KnowledgeReviewChange } | { ok: false; error: string }> {
  const change = await rebaseKnowledgeReviewChange(args)
  if (!change) return { ok: false, error: 'not_rebaseable' }

  await auditEvent({
    actorUserId: args.userId,
    action: 'knowledge.review_rebased',
    metadata: { changeId: change.id, kbPath: change.kbPath, baseHash: change.baseHash },
  })
  return { ok: true, change }
}

export async function regenerateKnowledgeReviewChangeForUser(args: {
  actor: string
  changeId: string
  slug: string
  userId: string
}): Promise<{ ok: true; run: LearningRun } | { ok: false; error: string }> {
  const change = await findKnowledgeReviewChange({ changeId: args.changeId, userId: args.userId })
  if (!change) return { ok: false, error: 'not_found' }
  if (change.status !== 'needs_rebase') return { ok: false, error: 'not_rebaseable' }

  const run = await startLearningRunForKnowledgeReviewRegeneration({
    actor: args.actor,
    changeId: change.id,
    title: `Regenerate ${change.title}`,
    userId: args.userId,
  })
  if (!run) return { ok: false, error: 'not_rebaseable' }

  const regeneration: KnowledgeReviewRegenerationContext = {
    actualContent: change.actualContent,
    baseContent: change.baseContent,
    changeId: change.id,
    kbPath: change.kbPath,
    operation: change.operation,
    proposedContent: change.proposedContent,
  }
  dispatchLearningRunExecution({
    runId: run.id,
    slug: args.slug,
    userId: args.userId,
    sourceSessionId: null,
    title: run.title,
    trigger: run.trigger,
    regeneration,
  })
  await auditEvent({
    actorUserId: args.userId,
    action: 'knowledge.review_regeneration_requested',
    metadata: { changeId: change.id, kbPath: change.kbPath, runId: run.id },
  })
  return { ok: true, run }
}

export async function applyKnowledgeReviewChange(args: {
  actor: string
  changeId: string
  content?: string
  slug: string
  userId: string
}): Promise<{ ok: true; change: KnowledgeReviewChange } | { ok: false; error: string }> {
  const change = await findKnowledgeReviewChange({ changeId: args.changeId, userId: args.userId })
  if (!change) return { ok: false, error: 'not_found' }
  if (change.status === 'needs_rebase') return { ok: false, error: 'needs_rebase' }
  if (change.status !== 'open') return { ok: false, error: 'not_open' }

  const agent = await createWorkspaceAgentClient(args.slug)
  if (!agent) return { ok: false, error: 'workspace_agent_unavailable' }

  const content = args.content ?? change.proposedContent
  const current = await captureCurrentKnowledgeReviewFile({ agent, kbPath: change.kbPath })
  if (change.operation === 'create') {
    if (current.hash) {
      await markKnowledgeReviewChangeNeedsRebase({
        actor: args.actor,
        actualContent: current.content,
        actualHash: current.hash,
        changeId: change.id,
        userId: args.userId,
      })
      return { ok: false, error: 'needs_rebase' }
    }
  } else if (!current.hash || current.hash !== change.baseHash) {
    await markKnowledgeReviewChangeNeedsRebase({
      actor: args.actor,
      actualContent: current.content,
      actualHash: current.hash,
      changeId: change.id,
      userId: args.userId,
    })
    return { ok: false, error: 'needs_rebase' }
  }

  if (change.operation === 'delete') {
    const deleted = await workspaceAgentFetch<FileDeleteResponse>(agent, '/files/delete', {
      path: change.kbPath,
      expectedHash: change.baseHash ?? '',
    })
    if (!deleted.ok) {
      const actual = await captureCurrentKnowledgeReviewFile({ agent, kbPath: change.kbPath })
      await markKnowledgeReviewChangeNeedsRebase({
        actor: args.actor,
        actualContent: actual.content,
        actualHash: actual.hash,
        changeId: change.id,
        userId: args.userId,
      })
      return { ok: false, error: 'needs_rebase' }
    }

    const updated = await markKnowledgeReviewChangeApplied({
      actor: args.actor,
      appliedHash: change.baseHash ?? 'deleted',
      changeId: change.id,
      content,
      userId: args.userId,
    })
    if (!updated) return { ok: false, error: 'not_open' }
    await auditEvent({ actorUserId: args.userId, action: 'knowledge.review_applied', metadata: { changeId: change.id, kbPath: change.kbPath } })
    return { ok: true, change: updated }
  }

  const write = await workspaceAgentFetch<FileWriteResponse>(agent, '/files/write', {
    path: change.kbPath,
    content,
    encoding: 'utf-8',
    expectedHash: change.operation === 'create' ? '' : change.baseHash ?? '',
  })
  if (!write.ok) {
    const actual = await captureCurrentKnowledgeReviewFile({ agent, kbPath: change.kbPath })
    await markKnowledgeReviewChangeNeedsRebase({
      actor: args.actor,
      actualContent: actual.content,
      actualHash: actual.hash,
      changeId: change.id,
      userId: args.userId,
    })
    return { ok: false, error: 'needs_rebase' }
  }

  const updated = await markKnowledgeReviewChangeApplied({
    actor: args.actor,
    appliedHash: write.data.hash,
    changeId: change.id,
    content,
    userId: args.userId,
  })
  if (!updated) return { ok: false, error: 'not_open' }

  await auditEvent({
    actorUserId: args.userId,
    action: 'knowledge.review_applied',
    metadata: { changeId: change.id, kbPath: change.kbPath, appliedHash: write.data.hash },
  })
  return { ok: true, change: updated }
}

import { auditEvent } from '@/lib/auth'
import { publishKnowledgeBasePaths, type PublishKbResult } from '@/lib/learning/publish-kb'
import {
  findKnowledgeReviewChange,
  markKnowledgeReviewChangeApplied,
  markKnowledgeReviewChangeApplying,
  markKnowledgeReviewChangeNeedsRebase,
  rebaseKnowledgeReviewChange,
  rejectKnowledgeReviewChange,
  saveKnowledgeReviewDraft,
  startLearningRunForKnowledgeReviewRegeneration,
} from '@/lib/learning/repository'
import { dispatchLearningRunExecution } from '@/lib/learning/run-executor'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'
import { workspaceAgentFetch } from '@/lib/workspace-agent-client'
import type {
  KnowledgeReviewChange,
  KnowledgeReviewOperation,
  KnowledgeReviewRegenerationContext,
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

  // Empty content is valid for a delete; for create/update it falls back to the
  // proposed content so an emptied editor cannot silently write an empty file.
  const content = args.content !== undefined && args.content !== ''
    ? args.content
    : change.proposedContent
  const current = await captureCurrentKnowledgeReviewFile({ agent, kbPath: change.kbPath })

  // Reserve the open -> applying transition before touching the KB so a
  // concurrent Reject (or a second Apply) cannot win after the file changed.
  // The record is finalized with markKnowledgeReviewChangeApplied or rolled
  // back to needs_rebase if the mutation fails.
  const reserved = await markKnowledgeReviewChangeApplying({
    actor: args.actor,
    actualContent: current.content,
    actualHash: current.hash,
    changeId: change.id,
    content,
    userId: args.userId,
  })
  if (!reserved) return { ok: false, error: 'not_open' }

  const rollbackToNeedsRebase = async (): Promise<void> => {
    const actual = await captureCurrentKnowledgeReviewFile({ agent, kbPath: change.kbPath })
    await markKnowledgeReviewChangeNeedsRebase({
      actor: args.actor,
      actualContent: actual.content,
      actualHash: actual.hash,
      changeId: change.id,
      userId: args.userId,
    })
  }

  // The file may already carry exactly the proposed change (e.g. an Explore
  // edit submitted for review, or a delete that already ran). In that case the
  // mutation is a no-op and applying only finalizes the record.
  const currentMatchesProposed = current.content === content

  if (change.operation === 'create') {
    if (current.hash && !currentMatchesProposed) {
      await markKnowledgeReviewChangeNeedsRebase({
        actor: args.actor,
        actualContent: current.content,
        actualHash: current.hash,
        changeId: change.id,
        userId: args.userId,
      })
      return { ok: false, error: 'needs_rebase' }
    }
  } else if (change.operation !== 'delete' && (!current.hash || (current.hash !== change.baseHash && !currentMatchesProposed))) {
    // Deletes verify the base through the delete call's expected hash, and an
    // already-deleted file is the applied state rather than a conflict.
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
    if (current.hash) {
      const deleted = await workspaceAgentFetch<FileDeleteResponse>(agent, '/files/delete', {
        path: change.kbPath,
        expectedHash: change.baseHash ?? '',
      })
      if (!deleted.ok) {
        await rollbackToNeedsRebase()
        return { ok: false, error: 'needs_rebase' }
      }
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

  if (!currentMatchesProposed) {
    const write = await workspaceAgentFetch<FileWriteResponse>(agent, '/files/write', {
      path: change.kbPath,
      content,
      encoding: 'utf-8',
      expectedHash: change.operation === 'create' ? '' : change.baseHash ?? '',
    })
    if (!write.ok) {
      await rollbackToNeedsRebase()
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

  const updated = await markKnowledgeReviewChangeApplied({
    actor: args.actor,
    appliedHash: current.hash ?? 'deleted',
    changeId: change.id,
    content,
    userId: args.userId,
  })
  if (!updated) return { ok: false, error: 'not_open' }

  await auditEvent({
    actorUserId: args.userId,
    action: 'knowledge.review_applied',
    metadata: { changeId: change.id, kbPath: change.kbPath, appliedHash: current.hash ?? 'deleted' },
  })
  return { ok: true, change: updated }
}

export async function applyAndPublishKnowledgeReviewChange(args: {
  actor: string
  changeId: string
  content?: string
  slug: string
  userId: string
}): Promise<
  | { ok: true; change: KnowledgeReviewChange; publish: PublishKbResult }
  | { ok: false; error: string }
> {
  const applied = await applyKnowledgeReviewChange(args)
  if (!applied.ok) return applied

  // Applying validates the proposal, so publish exactly that file right away.
  // If the publish step fails the change stays applied and its diff remains
  // visible under Manual edits as the natural fallback; the publish result
  // lets the UI surface the reason.
  const publish = await publishKnowledgeBasePaths({
    slug: args.slug,
    actorUserId: args.userId,
    paths: [applied.change.kbPath],
  })
  return { ok: true, change: applied.change, publish }
}

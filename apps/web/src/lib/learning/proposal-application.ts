import { auditEvent } from '@/lib/auth'
import {
  findPendingLearningProposal,
  updateLearningProposalApplied,
  updateLearningProposalRejected,
} from '@/lib/learning/repository'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'
import { workspaceAgentFetch } from '@/lib/workspace-agent-client'
import type { LearningProposal } from '@/types/learning'

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

export async function rejectLearningProposal(args: {
  userId: string
  proposalId: string
}): Promise<{ ok: true; proposal: LearningProposal } | { ok: false; error: string }> {
  const proposal = await findPendingLearningProposal({ proposalId: args.proposalId, userId: args.userId })
  if (!proposal) return { ok: false, error: 'not_found' }
  if (proposal.status !== 'pending') return { ok: false, error: 'not_pending' }

  const updated = await updateLearningProposalRejected(proposal.id)
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
  if (proposal.operation === 'update') {
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

  const updated = await updateLearningProposalApplied({ proposalId: proposal.id, content })
  await auditEvent({
    actorUserId: args.userId,
    action: 'learning.proposal_applied',
    metadata: { proposalId: proposal.id, kbPath: proposal.kbPath },
  })
  return { ok: true, proposal: updated }
}

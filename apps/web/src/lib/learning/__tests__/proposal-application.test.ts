import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyLearningProposal, rejectLearningProposal } from '@/lib/learning/proposal-application'
import type { LearningProposal } from '@/types/learning'

const mocks = vi.hoisted(() => ({
  auditEvent: vi.fn(),
  createWorkspaceAgentClient: vi.fn(),
  findPendingLearningProposal: vi.fn(),
  updatePendingLearningProposalApplied: vi.fn(),
  updatePendingLearningProposalRejected: vi.fn(),
  workspaceAgentFetch: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/workspace-agent/client', () => ({ createWorkspaceAgentClient: mocks.createWorkspaceAgentClient }))
vi.mock('@/lib/workspace-agent-client', () => ({ workspaceAgentFetch: mocks.workspaceAgentFetch }))
vi.mock('@/lib/learning/repository', () => ({
  findPendingLearningProposal: mocks.findPendingLearningProposal,
  updatePendingLearningProposalApplied: mocks.updatePendingLearningProposalApplied,
  updatePendingLearningProposalRejected: mocks.updatePendingLearningProposalRejected,
}))

const proposal: LearningProposal = {
  id: 'proposal-1',
  runId: 'run-1',
  status: 'pending',
  title: 'Remember preference',
  type: 'preference',
  confidence: 0.9,
  evidence: { quote: 'Prefer concise answers' },
  kbPath: 'Preferences/Answers.md',
  operation: 'update',
  proposedContent: 'Prefer concise answers.',
  currentFileHash: 'hash-old',
  internalSessionId: null,
  trigger: 'agent',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('applyLearningProposal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createWorkspaceAgentClient.mockResolvedValue({ baseUrl: 'http://agent', authHeader: 'Basic x' })
    mocks.findPendingLearningProposal.mockResolvedValue(proposal)
    mocks.updatePendingLearningProposalApplied.mockResolvedValue({ ...proposal, status: 'applied' })
  })

  it('rejects create proposals when the target file already exists', async () => {
    mocks.findPendingLearningProposal.mockResolvedValue({ ...proposal, operation: 'create', currentFileHash: null })
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: true, data: { hash: 'existing' }, status: 200 })

    const result = await applyLearningProposal({ userId: 'user-1', slug: 'alice', proposalId: 'proposal-1' })

    expect(result).toEqual({ ok: false, error: 'file_exists' })
    expect(mocks.workspaceAgentFetch).toHaveBeenCalledTimes(1)
    expect(mocks.updatePendingLearningProposalApplied).not.toHaveBeenCalled()
  })

  it('applies create proposals only after a not-found read', async () => {
    mocks.findPendingLearningProposal.mockResolvedValue({ ...proposal, operation: 'create', currentFileHash: null })
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({ ok: false, error: 'not_found', status: 404 })
      .mockResolvedValueOnce({ ok: true, data: { hash: 'hash-new' }, status: 200 })

    const result = await applyLearningProposal({ userId: 'user-1', slug: 'alice', proposalId: 'proposal-1' })

    expect(result).toMatchObject({ ok: true })
    expect(mocks.workspaceAgentFetch).toHaveBeenLastCalledWith(
      { baseUrl: 'http://agent', authHeader: 'Basic x' },
      '/files/write',
      { path: proposal.kbPath, content: proposal.proposedContent, encoding: 'utf-8', expectedHash: '' },
    )
  })

  it('returns hash_conflict when the current file hash changed', async () => {
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: true, data: { hash: 'hash-new' }, status: 200 })

    const result = await applyLearningProposal({ userId: 'user-1', slug: 'alice', proposalId: 'proposal-1' })

    expect(result).toEqual({ ok: false, error: 'hash_conflict' })
    expect(mocks.updatePendingLearningProposalApplied).not.toHaveBeenCalled()
  })

  it('returns not_pending when the guarded status update loses the race', async () => {
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({ ok: true, data: { hash: 'hash-old' }, status: 200 })
      .mockResolvedValueOnce({ ok: true, data: { hash: 'hash-new' }, status: 200 })
    mocks.updatePendingLearningProposalApplied.mockResolvedValue(null)

    const result = await applyLearningProposal({ userId: 'user-1', slug: 'alice', proposalId: 'proposal-1' })

    expect(result).toEqual({ ok: false, error: 'not_pending' })
    expect(mocks.auditEvent).not.toHaveBeenCalled()
  })
})

describe('rejectLearningProposal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findPendingLearningProposal.mockResolvedValue(proposal)
  })

  it('returns not_pending when the guarded reject update loses the race', async () => {
    mocks.updatePendingLearningProposalRejected.mockResolvedValue(null)

    const result = await rejectLearningProposal({ userId: 'user-1', proposalId: 'proposal-1' })

    expect(result).toEqual({ ok: false, error: 'not_pending' })
    expect(mocks.auditEvent).not.toHaveBeenCalled()
  })
})

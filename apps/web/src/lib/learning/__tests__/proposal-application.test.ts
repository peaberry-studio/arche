import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyAndPublishKnowledgeReviewChange,
  applyKnowledgeReviewChange,
  captureKnowledgeReviewBase,
  rebaseKnowledgeReviewChangeForUser,
  regenerateKnowledgeReviewChangeForUser,
  rejectKnowledgeReviewChangeForUser,
  saveKnowledgeReviewChangeDraft,
} from '@/lib/learning/proposal-application'
import type { KnowledgeReviewChange } from '@/types/learning'

const mocks = vi.hoisted(() => ({
  auditEvent: vi.fn(),
  createWorkspaceAgentClient: vi.fn(),
  dispatchLearningRunExecution: vi.fn(),
  findKnowledgeReviewChange: vi.fn(),
  markKnowledgeReviewChangeApplied: vi.fn(),
  markKnowledgeReviewChangeApplying: vi.fn(),
  markKnowledgeReviewChangeNeedsRebase: vi.fn(),
  publishKnowledgeBasePaths: vi.fn(),
  rebaseKnowledgeReviewChange: vi.fn(),
  rejectKnowledgeReviewChange: vi.fn(),
  saveKnowledgeReviewDraft: vi.fn(),
  startLearningRunForKnowledgeReviewRegeneration: vi.fn(),
  workspaceAgentFetch: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/workspace-agent/client', () => ({ createWorkspaceAgentClient: mocks.createWorkspaceAgentClient }))
vi.mock('@/lib/workspace-agent-client', () => ({ workspaceAgentFetch: mocks.workspaceAgentFetch }))
vi.mock('@/lib/learning/publish-kb', () => ({ publishKnowledgeBasePaths: mocks.publishKnowledgeBasePaths }))
vi.mock('@/lib/learning/repository', () => ({
  findKnowledgeReviewChange: mocks.findKnowledgeReviewChange,
  markKnowledgeReviewChangeApplied: mocks.markKnowledgeReviewChangeApplied,
  markKnowledgeReviewChangeApplying: mocks.markKnowledgeReviewChangeApplying,
  markKnowledgeReviewChangeNeedsRebase: mocks.markKnowledgeReviewChangeNeedsRebase,
  rebaseKnowledgeReviewChange: mocks.rebaseKnowledgeReviewChange,
  rejectKnowledgeReviewChange: mocks.rejectKnowledgeReviewChange,
  saveKnowledgeReviewDraft: mocks.saveKnowledgeReviewDraft,
  startLearningRunForKnowledgeReviewRegeneration: mocks.startLearningRunForKnowledgeReviewRegeneration,
}))
vi.mock('@/lib/learning/run-executor', () => ({ dispatchLearningRunExecution: mocks.dispatchLearningRunExecution }))

const change: KnowledgeReviewChange = {
  id: 'change-1',
  sourceProposalId: null,
  regeneratedFromId: null,
  runId: null,
  author: 'knowledge-curator',
  agent: 'knowledge-curator',
  origin: 'learning',
  title: 'Remember preference',
  reason: 'Durable preference.',
  evidence: { quote: 'Use concise answers' },
  confidence: 0.8,
  kbPath: 'Preferences/Answers.md',
  operation: 'update',
  baseContent: 'Old preference',
  baseHash: 'sha256:old',
  proposedContent: 'New preference.',
  status: 'open',
  actualContent: null,
  actualHash: null,
  appliedHash: null,
  publishCommitSha: null,
  auditTrail: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const agent = { baseUrl: 'http://agent', authHeader: 'Basic x' }

describe('captureKnowledgeReviewBase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createWorkspaceAgentClient.mockResolvedValue(agent)
  })

  it('returns workspace_agent_unavailable when the agent is unavailable', async () => {
    mocks.createWorkspaceAgentClient.mockResolvedValue(null)

    const result = await captureKnowledgeReviewBase({ kbPath: 'Notes/A.md', operation: 'update', slug: 'alice' })

    expect(result).toEqual({ ok: false, error: 'workspace_agent_unavailable' })
  })

  it('returns file_exists for a create operation when the file already exists', async () => {
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: true, data: { content: 'existing', hash: 'sha256:1' }, status: 200 })

    const result = await captureKnowledgeReviewBase({ kbPath: 'Notes/A.md', operation: 'create', slug: 'alice' })

    expect(result).toEqual({ ok: false, error: 'file_exists' })
  })

  it('captures a null base for a create operation when the file does not exist', async () => {
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: false, error: 'not_found', status: 404 })

    const result = await captureKnowledgeReviewBase({ kbPath: 'Notes/A.md', operation: 'create', slug: 'alice' })

    expect(result).toEqual({ ok: true, data: { baseContent: null, baseHash: null, initialStatus: 'open' } })
  })

  it('returns needs_rebase for an update operation when the file is missing', async () => {
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: false, error: 'not_found', status: 404 })

    const result = await captureKnowledgeReviewBase({ kbPath: 'Notes/A.md', operation: 'update', slug: 'alice' })

    expect(result).toEqual({ ok: true, data: { baseContent: null, baseHash: null, initialStatus: 'needs_rebase' } })
  })

  it('captures the canonical content and hash for an update operation', async () => {
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: true, data: { content: 'current', hash: 'sha256:current' }, status: 200 })

    const result = await captureKnowledgeReviewBase({ kbPath: 'Notes/A.md', operation: 'update', slug: 'alice' })

    expect(result).toEqual({ ok: true, data: { baseContent: 'current', baseHash: 'sha256:current', initialStatus: 'open' } })
  })

  it('returns the read error for a non-404 read failure', async () => {
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: false, error: 'read_failed', status: 500 })

    const result = await captureKnowledgeReviewBase({ kbPath: 'Notes/A.md', operation: 'update', slug: 'alice' })

    expect(result).toEqual({ ok: false, error: 'read_failed' })
  })
})

describe('applyKnowledgeReviewChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createWorkspaceAgentClient.mockResolvedValue(agent)
    mocks.findKnowledgeReviewChange.mockResolvedValue(change)
    mocks.markKnowledgeReviewChangeApplying.mockResolvedValue({ ...change, status: 'applying' })
  })

  it('returns not_found when the change does not exist', async () => {
    mocks.findKnowledgeReviewChange.mockResolvedValue(null)

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('returns needs_rebase when the change is already in needs_rebase status', async () => {
    mocks.findKnowledgeReviewChange.mockResolvedValue({ ...change, status: 'needs_rebase' })

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'needs_rebase' })
  })

  it('returns not_open when the change is not open', async () => {
    mocks.findKnowledgeReviewChange.mockResolvedValue({ ...change, status: 'applied' })

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'not_open' })
  })

  it('returns workspace_agent_unavailable when the agent is unavailable', async () => {
    mocks.createWorkspaceAgentClient.mockResolvedValue(null)

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'workspace_agent_unavailable' })
  })

  it('transitions to needs_rebase when a create operation finds the file already exists', async () => {
    mocks.findKnowledgeReviewChange.mockResolvedValue({ ...change, operation: 'create', baseHash: null, baseContent: null })
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: true, data: { content: 'existing', hash: 'sha256:existing' }, status: 200 })
    mocks.markKnowledgeReviewChangeNeedsRebase.mockResolvedValue({ ...change, status: 'needs_rebase' })

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'needs_rebase' })
    expect(mocks.markKnowledgeReviewChangeNeedsRebase).toHaveBeenCalledWith(expect.objectContaining({
      actualHash: 'sha256:existing',
      changeId: 'change-1',
      userId: 'user-1',
    }))
    expect(mocks.markKnowledgeReviewChangeApplied).not.toHaveBeenCalled()
  })

  it('transitions to needs_rebase when the current hash differs from the base hash', async () => {
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: true, data: { content: 'changed', hash: 'sha256:changed' }, status: 200 })
    mocks.markKnowledgeReviewChangeNeedsRebase.mockResolvedValue({ ...change, status: 'needs_rebase' })

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'needs_rebase' })
    expect(mocks.markKnowledgeReviewChangeNeedsRebase).toHaveBeenCalledWith(expect.objectContaining({
      actualHash: 'sha256:changed',
      changeId: 'change-1',
    }))
  })

  it('reserves the change before mutating the file so a concurrent reject cannot win', async () => {
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({ ok: true, data: { content: 'Old preference', hash: 'sha256:old' }, status: 200 })
      .mockResolvedValueOnce({ ok: true, data: { hash: 'sha256:new' }, status: 200 })
    mocks.markKnowledgeReviewChangeApplied.mockResolvedValue({ ...change, status: 'applied', appliedHash: 'sha256:new' })

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toMatchObject({ ok: true })
    expect(mocks.markKnowledgeReviewChangeApplying).toHaveBeenCalledWith(expect.objectContaining({
      changeId: 'change-1',
      content: change.proposedContent,
      actualHash: 'sha256:old',
      userId: 'user-1',
    }))
    // The reserve precedes the file mutation (the write), not the base read.
    expect(mocks.markKnowledgeReviewChangeApplying.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.workspaceAgentFetch.mock.invocationCallOrder[1],
    )
  })

  it('writes the file and marks the change applied for a matching update', async () => {
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({ ok: true, data: { content: 'Old preference', hash: 'sha256:old' }, status: 200 })
      .mockResolvedValueOnce({ ok: true, data: { hash: 'sha256:new' }, status: 200 })
    mocks.markKnowledgeReviewChangeApplied.mockResolvedValue({ ...change, status: 'applied', appliedHash: 'sha256:new' })

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toMatchObject({ ok: true })
    expect(mocks.workspaceAgentFetch).toHaveBeenLastCalledWith(
      agent,
      '/files/write',
      { path: change.kbPath, content: change.proposedContent, encoding: 'utf-8', expectedHash: 'sha256:old' },
    )
    expect(mocks.markKnowledgeReviewChangeApplied).toHaveBeenCalledWith(expect.objectContaining({
      appliedHash: 'sha256:new',
      changeId: 'change-1',
      content: change.proposedContent,
    }))
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'knowledge.review_applied' }))
  })

  it('uses the edited content when provided', async () => {
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({ ok: true, data: { content: 'Old preference', hash: 'sha256:old' }, status: 200 })
      .mockResolvedValueOnce({ ok: true, data: { hash: 'sha256:edited' }, status: 200 })
    mocks.markKnowledgeReviewChangeApplied.mockResolvedValue({ ...change, status: 'applied' })

    await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', content: 'Edited content', slug: 'alice', userId: 'user-1' })

    expect(mocks.workspaceAgentFetch).toHaveBeenLastCalledWith(
      agent,
      '/files/write',
      expect.objectContaining({ content: 'Edited content' }),
    )
  })

  it('falls back to the proposed content when apply carries empty content for a non-delete', async () => {
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({ ok: true, data: { content: 'Old preference', hash: 'sha256:old' }, status: 200 })
      .mockResolvedValueOnce({ ok: true, data: { hash: 'sha256:new' }, status: 200 })
    mocks.markKnowledgeReviewChangeApplied.mockResolvedValue({ ...change, status: 'applied' })

    await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', content: '', slug: 'alice', userId: 'user-1' })

    expect(mocks.workspaceAgentFetch).toHaveBeenLastCalledWith(
      agent,
      '/files/write',
      expect.objectContaining({ content: change.proposedContent }),
    )
  })

  it('applies without writing when the working tree already matches the proposal', async () => {
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: true, data: { content: 'New preference.', hash: 'sha256:new' }, status: 200 })
    mocks.markKnowledgeReviewChangeApplied.mockResolvedValue({ ...change, status: 'applied', appliedHash: 'sha256:new' })

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toMatchObject({ ok: true })
    expect(mocks.workspaceAgentFetch).toHaveBeenCalledTimes(1)
    expect(mocks.markKnowledgeReviewChangeApplied).toHaveBeenCalledWith(expect.objectContaining({
      appliedHash: 'sha256:new',
    }))
  })

  it('deletes the file and marks applied for a delete operation', async () => {
    mocks.findKnowledgeReviewChange.mockResolvedValue({ ...change, operation: 'delete' })
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({ ok: true, data: { content: 'Old preference', hash: 'sha256:old' }, status: 200 })
      .mockResolvedValueOnce({ ok: true, data: { deleted: true }, status: 200 })
    mocks.markKnowledgeReviewChangeApplied.mockResolvedValue({ ...change, status: 'applied' })

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toMatchObject({ ok: true })
    expect(mocks.workspaceAgentFetch).toHaveBeenLastCalledWith(
      agent,
      '/files/delete',
      { path: change.kbPath, expectedHash: 'sha256:old' },
    )
    expect(mocks.markKnowledgeReviewChangeApplied).toHaveBeenCalledWith(expect.objectContaining({
      appliedHash: 'sha256:old',
    }))
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'knowledge.review_applied' }))
  })

  it('marks an already-deleted file applied without calling delete again', async () => {
    mocks.findKnowledgeReviewChange.mockResolvedValue({ ...change, operation: 'delete' })
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: false, error: 'not_found', status: 404 })
    mocks.markKnowledgeReviewChangeApplied.mockResolvedValue({ ...change, status: 'applied' })

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toMatchObject({ ok: true })
    expect(mocks.workspaceAgentFetch).toHaveBeenCalledTimes(1)
    expect(mocks.markKnowledgeReviewChangeApplied).toHaveBeenCalledWith(expect.objectContaining({
      appliedHash: change.baseHash,
    }))
  })

  it('transitions to needs_rebase when the write fails', async () => {
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({ ok: true, data: { content: 'Old preference', hash: 'sha256:old' }, status: 200 })
      .mockResolvedValueOnce({ ok: false, error: 'conflict', status: 409 })
      .mockResolvedValueOnce({ ok: true, data: { content: 'actual', hash: 'sha256:actual' }, status: 200 })
    mocks.markKnowledgeReviewChangeNeedsRebase.mockResolvedValue({ ...change, status: 'needs_rebase' })

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'needs_rebase' })
    expect(mocks.markKnowledgeReviewChangeNeedsRebase).toHaveBeenCalledWith(expect.objectContaining({
      actualHash: 'sha256:actual',
      changeId: 'change-1',
    }))
    expect(mocks.markKnowledgeReviewChangeApplied).not.toHaveBeenCalled()
  })

  it('returns not_open without mutating when the reserve loses the race', async () => {
    mocks.markKnowledgeReviewChangeApplying.mockResolvedValue(null)
    mocks.workspaceAgentFetch.mockResolvedValueOnce({ ok: true, data: { content: 'Old preference', hash: 'sha256:old' }, status: 200 })

    const result = await applyKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'not_open' })
    expect(mocks.workspaceAgentFetch).toHaveBeenCalledTimes(1)
    expect(mocks.markKnowledgeReviewChangeApplied).not.toHaveBeenCalled()
    expect(mocks.auditEvent).not.toHaveBeenCalled()
  })
})

describe('saveKnowledgeReviewChangeDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns not_open when the repository guard rejects the transition', async () => {
    mocks.saveKnowledgeReviewDraft.mockResolvedValue(null)

    const result = await saveKnowledgeReviewChangeDraft({ actor: 'user-1', changeId: 'change-1', content: 'draft', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'not_open' })
    expect(mocks.auditEvent).not.toHaveBeenCalled()
  })

  it('persists the draft and audits the save', async () => {
    mocks.saveKnowledgeReviewDraft.mockResolvedValue({ ...change, proposedContent: 'draft' })

    const result = await saveKnowledgeReviewChangeDraft({ actor: 'user-1', changeId: 'change-1', content: 'draft', userId: 'user-1' })

    expect(result).toMatchObject({ ok: true })
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'knowledge.review_draft_saved',
      metadata: { changeId: change.id, kbPath: change.kbPath },
    }))
  })
})

describe('rejectKnowledgeReviewChangeForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns not_open when the repository guard rejects the transition', async () => {
    mocks.rejectKnowledgeReviewChange.mockResolvedValue(null)

    const result = await rejectKnowledgeReviewChangeForUser({ actor: 'user-1', changeId: 'change-1', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'not_open' })
    expect(mocks.auditEvent).not.toHaveBeenCalled()
  })

  it('rejects the change and audits', async () => {
    mocks.rejectKnowledgeReviewChange.mockResolvedValue({ ...change, status: 'rejected' })

    const result = await rejectKnowledgeReviewChangeForUser({ actor: 'user-1', changeId: 'change-1', userId: 'user-1' })

    expect(result).toMatchObject({ ok: true })
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'knowledge.review_rejected',
    }))
  })
})

describe('rebaseKnowledgeReviewChangeForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns not_rebaseable when the repository cannot rebase', async () => {
    mocks.rebaseKnowledgeReviewChange.mockResolvedValue(null)

    const result = await rebaseKnowledgeReviewChangeForUser({ actor: 'user-1', changeId: 'change-1', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'not_rebaseable' })
    expect(mocks.auditEvent).not.toHaveBeenCalled()
  })

  it('rebases the change and audits with the new hash', async () => {
    const rebased = { ...change, status: 'open', baseHash: 'sha256:actual', baseContent: 'Actual content' }
    mocks.rebaseKnowledgeReviewChange.mockResolvedValue(rebased)

    const result = await rebaseKnowledgeReviewChangeForUser({ actor: 'user-1', changeId: 'change-1', userId: 'user-1' })

    expect(result).toMatchObject({ ok: true })
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'knowledge.review_rebased',
      metadata: { changeId: change.id, kbPath: change.kbPath, baseHash: 'sha256:actual' },
    }))
  })
})

describe('regenerateKnowledgeReviewChangeForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns not_found when the change does not exist', async () => {
    mocks.findKnowledgeReviewChange.mockResolvedValue(null)

    const result = await regenerateKnowledgeReviewChangeForUser({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('returns not_rebaseable when the change is not in needs_rebase status', async () => {
    mocks.findKnowledgeReviewChange.mockResolvedValue({ ...change, status: 'open' })

    const result = await regenerateKnowledgeReviewChangeForUser({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'not_rebaseable' })
  })

  it('returns not_rebaseable when the regeneration run cannot be created', async () => {
    mocks.findKnowledgeReviewChange.mockResolvedValue({ ...change, status: 'needs_rebase' })
    mocks.startLearningRunForKnowledgeReviewRegeneration.mockResolvedValue(null)

    const result = await regenerateKnowledgeReviewChangeForUser({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'not_rebaseable' })
    expect(mocks.dispatchLearningRunExecution).not.toHaveBeenCalled()
  })

  it('creates a run, dispatches execution, and audits', async () => {
    const needsRebaseChange = { ...change, status: 'needs_rebase', actualContent: 'Actual content', actualHash: 'sha256:actual' }
    mocks.findKnowledgeReviewChange.mockResolvedValue(needsRebaseChange)
    const run = { id: 'run-2', sourceSessionId: null, internalSessionId: null, regenerationChangeId: change.id, title: 'Regenerate Remember preference', trigger: 'manual' as const, status: 'pending' as const, error: null, messageCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    mocks.startLearningRunForKnowledgeReviewRegeneration.mockResolvedValue(run)

    const result = await regenerateKnowledgeReviewChangeForUser({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toMatchObject({ ok: true })
    expect(mocks.dispatchLearningRunExecution).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-2',
      slug: 'alice',
      regeneration: {
        actualContent: 'Actual content',
        baseContent: change.baseContent,
        changeId: change.id,
        kbPath: change.kbPath,
        operation: change.operation,
        proposedContent: change.proposedContent,
      },
    }))
    expect(mocks.auditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'knowledge.review_regeneration_requested',
      metadata: { changeId: change.id, kbPath: change.kbPath, runId: 'run-2' },
    }))
  })
})

describe('applyAndPublishKnowledgeReviewChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createWorkspaceAgentClient.mockResolvedValue(agent)
    mocks.findKnowledgeReviewChange.mockResolvedValue(change)
    mocks.markKnowledgeReviewChangeApplying.mockResolvedValue({ ...change, status: 'applying' })
    mocks.publishKnowledgeBasePaths.mockResolvedValue({ ok: true, status: 'published', commitHash: 'sha256:commit' })
  })

  it('applies and publishes the change path', async () => {
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({ ok: true, data: { content: 'Old preference', hash: 'sha256:old' }, status: 200 })
      .mockResolvedValueOnce({ ok: true, data: { hash: 'sha256:new' }, status: 200 })
    mocks.markKnowledgeReviewChangeApplied.mockResolvedValue({ ...change, status: 'applied', appliedHash: 'sha256:new' })

    const result = await applyAndPublishKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toMatchObject({
      ok: true,
      change: expect.objectContaining({ status: 'applied', appliedHash: 'sha256:new' }),
      publish: { ok: true, status: 'published', commitHash: 'sha256:commit' },
    })
    expect(mocks.publishKnowledgeBasePaths).toHaveBeenCalledWith({
      slug: 'alice',
      actorUserId: 'user-1',
      paths: [change.kbPath],
    })
  })

  it('returns the publish failure when apply succeeds but publish fails', async () => {
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({ ok: true, data: { content: 'Old preference', hash: 'sha256:old' }, status: 200 })
      .mockResolvedValueOnce({ ok: true, data: { hash: 'sha256:new' }, status: 200 })
    mocks.markKnowledgeReviewChangeApplied.mockResolvedValue({ ...change, status: 'applied', appliedHash: 'sha256:new' })
    mocks.publishKnowledgeBasePaths.mockResolvedValue({ ok: false, status: 'push_rejected', message: 'fetch first' })

    const result = await applyAndPublishKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toMatchObject({ ok: true })
    expect(result).toMatchObject({
      change: expect.objectContaining({ status: 'applied' }),
      publish: { ok: false, status: 'push_rejected', message: 'fetch first' },
    })
    expect(mocks.publishKnowledgeBasePaths).toHaveBeenCalledWith({
      slug: 'alice',
      actorUserId: 'user-1',
      paths: [change.kbPath],
    })
  })

  it('returns apply errors without publishing', async () => {
    mocks.findKnowledgeReviewChange.mockResolvedValue(null)

    const result = await applyAndPublishKnowledgeReviewChange({ actor: 'user-1', changeId: 'change-1', slug: 'alice', userId: 'user-1' })

    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(mocks.publishKnowledgeBasePaths).not.toHaveBeenCalled()
  })
})

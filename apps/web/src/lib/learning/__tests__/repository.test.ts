import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isDesktop: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    knowledgeLearningProposal: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    knowledgeLearningRun: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    knowledgeReviewChange: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))

const now = new Date('2026-01-01T00:00:00.000Z')

const runRecord = {
  id: 'run-1',
  userId: 'user-1',
  sourceSessionId: 'session-1',
  internalSessionId: 'learning-session-1',
  regenerationChangeId: null,
  title: 'Session',
  trigger: 'manual',
  status: 'pending',
  error: null,
  messageCount: 0,
  createdAt: now,
  updatedAt: now,
}

const reviewRecord = {
  id: 'change-1',
  userId: 'user-1',
  sourceProposalId: null,
  regeneratedFromId: null,
  runId: null,
  author: 'Alice',
  agent: 'curator',
  origin: 'learning',
  title: 'Remember preference',
  reason: 'Durable preference',
  evidence: { quote: 'Use concise answers' },
  confidence: 0.8,
  kbPath: 'Preferences/Answers.md',
  operation: 'update',
  baseContent: 'Old preference',
  baseHash: 'base-hash',
  actualContent: 'Current preference',
  actualHash: 'current-hash',
  proposedContent: 'Use concise answers.',
  status: 'needs_rebase',
  appliedAt: null,
  appliedHash: null,
  publishedAt: null,
  auditTrail: [],
  createdAt: now,
  updatedAt: now,
}

describe('learning repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isDesktop.mockReturnValue(false)
    mocks.prisma.$executeRaw.mockResolvedValue(1)
    mocks.prisma.$transaction.mockImplementation(async (callback: (transaction: typeof mocks.prisma) => unknown) => callback(mocks.prisma))
    mocks.prisma.knowledgeReviewChange.findMany.mockResolvedValue([])
  })

  it('marks only applied content actually present in the approved commit', async () => {
    const { markKnowledgeReviewChangesPublished } = await import('@/lib/learning/repository')
    const applied = { ...reviewRecord, status: 'applied', appliedHash: 'sha256:approved' }
    mocks.prisma.knowledgeReviewChange.findMany.mockResolvedValue([
      applied, { ...applied, id: 'other', kbPath: 'Other.md', appliedHash: 'sha256:newer' },
    ])
    mocks.prisma.knowledgeReviewChange.findFirst.mockResolvedValue(applied)
    mocks.prisma.knowledgeReviewChange.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.knowledgeReviewChange.findUnique.mockResolvedValue({ ...applied, status: 'published' })
    await markKnowledgeReviewChangesPublished({ actor: 'admin', commitSha: 'commit', paths: [applied.kbPath, 'Other.md'], userId: 'user-1', pathHashes: { [applied.kbPath]: 'sha256:approved', 'Other.md': 'sha256:old' } })
    expect(mocks.prisma.knowledgeReviewChange.updateMany).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.knowledgeReviewChange.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'change-1', appliedHash: 'sha256:approved' }) }))
  })

  it('does not mark a newer applied revision published after the approval snapshot', async () => {
    const { markKnowledgeReviewChangesPublished } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeReviewChange.findMany.mockResolvedValue([{ ...reviewRecord, status: 'applied', appliedHash: 'sha256:approved' }])
    mocks.prisma.knowledgeReviewChange.findFirst.mockResolvedValue({ ...reviewRecord, status: 'applied', appliedHash: 'sha256:newer' })
    expect(await markKnowledgeReviewChangesPublished({ actor: 'admin', commitSha: 'commit', paths: [reviewRecord.kbPath], userId: 'user-1', pathHashes: { [reviewRecord.kbPath]: 'sha256:approved' } })).toEqual([])
    expect(mocks.prisma.knowledgeReviewChange.updateMany).not.toHaveBeenCalled()
  })

  it('maps learning run list results', async () => {
    const { listLearningRuns } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeLearningRun.findMany.mockResolvedValue([runRecord])

    await expect(listLearningRuns('user-1')).resolves.toEqual([
      expect.objectContaining({ id: 'run-1', createdAt: now.toISOString() }),
    ])
  })

  it('treats running runs and only fresh pending runs as active', async () => {
    const { hasActiveLearningRun } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeLearningRun.findFirst.mockResolvedValue(runRecord)
    const pendingSince = new Date('2026-01-01T00:00:00.000Z')

    await expect(hasActiveLearningRun({ userId: 'user-1', sessionId: 'session-1', pendingSince })).resolves.toBe(true)
    expect(mocks.prisma.knowledgeLearningRun.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        sourceSessionId: 'session-1',
        OR: [
          { status: 'running' },
          { status: 'pending', createdAt: { gte: pendingSince } },
        ],
      },
    })
  })

  it('cancels only active learning runs for the owning user', async () => {
    const { cancelLearningRun } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeLearningRun.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.knowledgeLearningRun.findFirst.mockResolvedValue({ ...runRecord, status: 'cancelled' })

    await expect(cancelLearningRun({ runId: 'run-1', userId: 'user-1' })).resolves.toEqual(
      expect.objectContaining({ id: 'run-1', status: 'cancelled' }),
    )

    expect(mocks.prisma.knowledgeLearningRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', userId: 'user-1', status: { in: ['pending', 'running'] } },
      data: { error: null, finishedAt: expect.any(Date), status: 'cancelled' },
    })
  })

  it('returns null when no active learning run is cancelled', async () => {
    const { cancelLearningRun } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeLearningRun.updateMany.mockResolvedValue({ count: 0 })

    await expect(cancelLearningRun({ runId: 'run-1', userId: 'user-1' })).resolves.toBeNull()

    expect(mocks.prisma.knowledgeLearningRun.findFirst).not.toHaveBeenCalled()
  })

  it('guards terminal learning run transitions from overwriting cancellations', async () => {
    const { markLearningRunFailed, markLearningRunSucceeded } = await import('@/lib/learning/repository')

    await markLearningRunSucceeded('run-1')
    await markLearningRunFailed({ runId: 'run-1', error: 'provider_failed' })

    expect(mocks.prisma.knowledgeLearningRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'running' },
      data: { finishedAt: expect.any(Date), status: 'succeeded' },
    })
    expect(mocks.prisma.knowledgeLearningRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'running' },
      data: { error: 'provider_failed', finishedAt: expect.any(Date), status: 'failed' },
    })
  })

  it('does not supersede a conflicted change when its replacement cannot be created', async () => {
    const { createKnowledgeReviewChange } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeReviewChange.create.mockRejectedValue(new Error('database unavailable'))

    await expect(createKnowledgeReviewChange('user-1', {
      author: 'Alice',
      confidence: 0.8,
      evidence: { quote: 'Use concise answers' },
      kbPath: reviewRecord.kbPath,
      operation: 'update',
      origin: 'learning',
      proposedContent: 'Replacement content',
      reason: 'Regenerated against current content',
      regeneratedFromId: reviewRecord.id,
      runId: 'run-2',
      title: 'Replacement',
    })).rejects.toThrow('database unavailable')

    expect(mocks.prisma.knowledgeReviewChange.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { not: reviewRecord.id } }),
    }))
    expect(mocks.prisma.knowledgeReviewChange.findFirst).not.toHaveBeenCalled()
  })

  describe('a new proposal for a path with a pending one', () => {
    const proposal = {
      author: 'curator',
      confidence: 0.8,
      evidence: {},
      kbPath: reviewRecord.kbPath,
      operation: 'update' as const,
      origin: 'learning',
      proposedContent: 'Merged content',
      reason: 'New fact',
      title: 'New fact',
    }
    const pending = { ...reviewRecord, status: 'open' as const, auditTrail: [{ action: 'created', actor: 'curator', at: now.toISOString() }] }
    const revision = createHash('sha256').update(JSON.stringify([pending.id, pending.updatedAt.toISOString(), pending.operation, pending.proposedContent])).digest('hex')

    beforeEach(() => {
      mocks.prisma.knowledgeReviewChange.create.mockResolvedValue({ ...reviewRecord, id: 'change-2', status: 'open' })
      mocks.prisma.knowledgeReviewChange.updateMany.mockResolvedValue({ count: 1 })
    })

    it('returns the pending proposal instead of dropping it when the caller has not merged it', async () => {
      const { createKnowledgeReviewChange } = await import('@/lib/learning/repository')
      mocks.prisma.knowledgeReviewChange.findMany.mockResolvedValue([pending])

      for (const supersedesId of [undefined, 'some-other-change']) {
        expect(await createKnowledgeReviewChange('user-1', { ...proposal, requirePendingAcknowledged: true, supersedesId })).toEqual({
          ok: false,
          error: 'pending_proposal_exists',
          pending: { id: 'change-1', revision, operation: 'update', proposedContent: 'Use concise answers.', reason: 'Durable preference', status: 'open', title: 'Remember preference' },
        })
      }
      expect(mocks.prisma.knowledgeReviewChange.updateMany).not.toHaveBeenCalled()
      expect(mocks.prisma.knowledgeReviewChange.create).not.toHaveBeenCalled()
    })

    it('replaces the pending proposal it merged, guarded and audited', async () => {
      const { createKnowledgeReviewChange } = await import('@/lib/learning/repository')
      mocks.prisma.knowledgeReviewChange.findMany.mockResolvedValue([pending])

      const result = await createKnowledgeReviewChange('user-1', { ...proposal, requirePendingAcknowledged: true, supersedesId: 'change-1', supersedesRevision: revision })

      expect(result).toEqual(expect.objectContaining({ ok: true, change: expect.objectContaining({ id: 'change-2' }) }))
      const update = mocks.prisma.knowledgeReviewChange.updateMany.mock.calls[0][0]
      expect(update.where).toEqual({ id: 'change-1', status: 'open', updatedAt: now, proposedContent: pending.proposedContent })
      expect(update.data.status).toBe('superseded')
      expect(JSON.stringify(update.data.auditTrail)).toContain('superseded')
      expect(mocks.prisma.knowledgeReviewChange.create).toHaveBeenCalled()
    })

    it('rejects an acknowledgement after the user edits the same pending proposal', async () => {
      const { createKnowledgeReviewChange } = await import('@/lib/learning/repository')
      // Even an edit in the same timestamp tick must invalidate the revision.
      mocks.prisma.knowledgeReviewChange.findMany.mockResolvedValue([{ ...pending, proposedContent: 'User draft must survive.' }])
      const result = await createKnowledgeReviewChange('user-1', {
        ...proposal, requirePendingAcknowledged: true, supersedesId: pending.id, supersedesRevision: revision,
      })
      expect(result).toEqual(expect.objectContaining({
        ok: false, error: 'pending_proposal_exists',
        pending: expect.objectContaining({ proposedContent: 'User draft must survive.', revision: expect.not.stringMatching(revision) }),
      }))
      expect(mocks.prisma.knowledgeReviewChange.updateMany).not.toHaveBeenCalled()
      expect(mocks.prisma.knowledgeReviewChange.create).not.toHaveBeenCalled()
    })

    it('still replaces pending proposals for explicit writes that do not merge', async () => {
      const { createKnowledgeReviewChange } = await import('@/lib/learning/repository')
      mocks.prisma.knowledgeReviewChange.findMany.mockResolvedValue([pending])

      expect(await createKnowledgeReviewChange('user-1', { ...proposal, origin: 'mcp' })).toEqual(expect.objectContaining({ ok: true }))
      expect(mocks.prisma.knowledgeReviewChange.updateMany).toHaveBeenCalledTimes(1)
    })

    it('refuses while the pending proposal is being applied and replaces an interrupted apply', async () => {
      const { createKnowledgeReviewChange } = await import('@/lib/learning/repository')
      const applying = { ...pending, status: 'applying' as const, appliedAt: new Date() }
      mocks.prisma.knowledgeReviewChange.findMany.mockResolvedValue([applying])
      expect(await createKnowledgeReviewChange('user-1', { ...proposal, requirePendingAcknowledged: true, supersedesId: 'change-1', supersedesRevision: revision })).toEqual({ ok: false, error: 'pending_proposal_applying' })
      expect(mocks.prisma.knowledgeReviewChange.create).not.toHaveBeenCalled()

      mocks.prisma.knowledgeReviewChange.findMany.mockResolvedValue([{ ...applying, appliedAt: new Date(Date.now() - 10 * 60 * 1000) }])
      expect(await createKnowledgeReviewChange('user-1', { ...proposal, requirePendingAcknowledged: true })).toEqual(expect.objectContaining({
        error: 'pending_proposal_exists',
        pending: expect.objectContaining({ status: 'needs_rebase' }),
      }))
      expect(await createKnowledgeReviewChange('user-1', { ...proposal, requirePendingAcknowledged: true, supersedesId: 'change-1', supersedesRevision: revision })).toEqual(expect.objectContaining({ ok: true }))
    })

    it('does not create the replacement when an apply claims the pending proposal first', async () => {
      const { createKnowledgeReviewChange } = await import('@/lib/learning/repository')
      mocks.prisma.knowledgeReviewChange.findMany.mockResolvedValue([pending])
      mocks.prisma.knowledgeReviewChange.updateMany.mockResolvedValue({ count: 0 })

      expect(await createKnowledgeReviewChange('user-1', { ...proposal, requirePendingAcknowledged: true, supersedesId: 'change-1', supersedesRevision: revision })).toEqual({ ok: false, error: 'pending_proposal_applying' })
      expect(mocks.prisma.knowledgeReviewChange.create).not.toHaveBeenCalled()
    })
  })

  it('creates and links a replacement before superseding its conflicted source', async () => {
    const { createKnowledgeReviewChange } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeReviewChange.create.mockResolvedValue({
      ...reviewRecord,
      id: 'change-2',
      regeneratedFromId: reviewRecord.id,
      runId: 'run-2',
      status: 'open',
    })
    mocks.prisma.knowledgeReviewChange.findFirst.mockResolvedValue(reviewRecord)
    mocks.prisma.knowledgeReviewChange.updateMany.mockResolvedValue({ count: 1 })

    const result = await createKnowledgeReviewChange('user-1', {
      author: 'Alice',
      confidence: 0.8,
      evidence: { quote: 'Use concise answers' },
      kbPath: reviewRecord.kbPath,
      operation: 'update',
      origin: 'learning',
      proposedContent: 'Replacement content',
      reason: 'Regenerated against current content',
      regeneratedFromId: reviewRecord.id,
      runId: 'run-2',
      title: 'Replacement',
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      change: expect.objectContaining({
        id: 'change-2',
        regeneratedFromId: reviewRecord.id,
      }),
    }))

    expect(mocks.prisma.knowledgeReviewChange.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ regeneratedFromId: reviewRecord.id, runId: 'run-2' }),
    }))
    expect(mocks.prisma.knowledgeReviewChange.create.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.knowledgeReviewChange.findFirst.mock.invocationCallOrder[0],
    )
    expect(mocks.prisma.knowledgeReviewChange.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'superseded' }),
      where: { id: reviewRecord.id, userId: 'user-1', status: { in: ['needs_rebase', 'applying'] } },
    }))
  })

  it('creates a regeneration run only while the source is conflicted', async () => {
    const { startLearningRunForKnowledgeReviewRegeneration } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeReviewChange.findFirst.mockResolvedValue(reviewRecord)
    mocks.prisma.knowledgeReviewChange.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.knowledgeLearningRun.create.mockResolvedValue({
      ...runRecord,
      id: 'run-2',
      regenerationChangeId: reviewRecord.id,
      sourceSessionId: null,
      internalSessionId: null,
    })

    await expect(startLearningRunForKnowledgeReviewRegeneration({
      actor: 'Alice',
      changeId: reviewRecord.id,
      title: 'Regenerate Remember preference',
      userId: 'user-1',
    })).resolves.toEqual(expect.objectContaining({ id: 'run-2', regenerationChangeId: reviewRecord.id }))

    expect(mocks.prisma.knowledgeLearningRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ regenerationChangeId: reviewRecord.id, trigger: 'manual' }),
    }))
  })

  it('guards the regeneration audit write on the snapshot it was read from', async () => {
    const { startLearningRunForKnowledgeReviewRegeneration } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeReviewChange.findFirst.mockResolvedValue(reviewRecord)
    mocks.prisma.knowledgeReviewChange.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.knowledgeLearningRun.create.mockResolvedValue({ ...runRecord, id: 'run-2' })

    await startLearningRunForKnowledgeReviewRegeneration({
      actor: 'Alice',
      changeId: reviewRecord.id,
      title: 'Regenerate Remember preference',
      userId: 'user-1',
    })

    expect(mocks.prisma.knowledgeReviewChange.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ updatedAt: reviewRecord.updatedAt }),
    }))
  })

  it('guards a transition on the snapshot its audit trail was read from', async () => {
    const { saveKnowledgeReviewDraft } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeReviewChange.findFirst.mockResolvedValue({ ...reviewRecord, status: 'open' })
    mocks.prisma.knowledgeReviewChange.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.knowledgeReviewChange.findUnique.mockResolvedValue({ ...reviewRecord, status: 'open' })

    await saveKnowledgeReviewDraft({
      actor: 'alice',
      changeId: reviewRecord.id,
      content: 'Edited content',
      userId: 'user-1',
    })

    expect(mocks.prisma.knowledgeReviewChange.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ updatedAt: reviewRecord.updatedAt }),
    }))
  })

  it('returns null when a transition loses the race for its snapshot', async () => {
    const { saveKnowledgeReviewDraft } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeReviewChange.findFirst.mockResolvedValue({ ...reviewRecord, status: 'open' })
    mocks.prisma.knowledgeReviewChange.updateMany.mockResolvedValue({ count: 0 })

    await expect(saveKnowledgeReviewDraft({
      actor: 'alice',
      changeId: reviewRecord.id,
      content: 'Edited content',
      userId: 'user-1',
    })).resolves.toBeNull()

    expect(mocks.prisma.knowledgeReviewChange.findUnique).not.toHaveBeenCalled()
  })

  it('coalesces consecutive draft saves by the same actor into one audit entry', async () => {
    const { saveKnowledgeReviewDraft } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeReviewChange.findFirst.mockResolvedValue({
      ...reviewRecord,
      status: 'open',
      auditTrail: [
        { action: 'created', actor: 'knowledge-curator', at: '2026-01-01T00:00:00.000Z' },
        { action: 'draft_saved', actor: 'alice', at: '2026-01-01T00:01:00.000Z' },
      ],
    })
    mocks.prisma.knowledgeReviewChange.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.knowledgeReviewChange.findUnique.mockResolvedValue({ ...reviewRecord, status: 'open' })

    await saveKnowledgeReviewDraft({
      actor: 'alice',
      changeId: reviewRecord.id,
      content: 'Edited content',
      userId: 'user-1',
    })

    const { data } = mocks.prisma.knowledgeReviewChange.updateMany.mock.calls[0][0]
    expect(data.auditTrail).toEqual([
      { action: 'created', actor: 'knowledge-curator', at: '2026-01-01T00:00:00.000Z' },
      expect.objectContaining({ action: 'draft_saved', actor: 'alice' }),
    ])
    expect(data.auditTrail[1].at).not.toBe('2026-01-01T00:01:00.000Z')
  })

  it('keeps draft saves from a different actor as their own audit entry', async () => {
    const { saveKnowledgeReviewDraft } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeReviewChange.findFirst.mockResolvedValue({
      ...reviewRecord,
      status: 'open',
      auditTrail: [{ action: 'draft_saved', actor: 'alice', at: '2026-01-01T00:01:00.000Z' }],
    })
    mocks.prisma.knowledgeReviewChange.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.knowledgeReviewChange.findUnique.mockResolvedValue({ ...reviewRecord, status: 'open' })

    await saveKnowledgeReviewDraft({
      actor: 'bob',
      changeId: reviewRecord.id,
      content: 'Edited content',
      userId: 'user-1',
    })

    const { data } = mocks.prisma.knowledgeReviewChange.updateMany.mock.calls[0][0]
    expect(data.auditTrail).toHaveLength(2)
    expect(data.auditTrail[1]).toEqual(expect.objectContaining({ action: 'draft_saved', actor: 'bob' }))
  })

  it('never coalesces decision entries that record a real state change', async () => {
    const { markKnowledgeReviewChangeNeedsRebase } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeReviewChange.findFirst.mockResolvedValue({
      ...reviewRecord,
      status: 'needs_rebase',
      auditTrail: [{ action: 'needs_rebase', actor: 'system', at: '2026-01-01T00:01:00.000Z' }],
    })
    mocks.prisma.knowledgeReviewChange.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.knowledgeReviewChange.findUnique.mockResolvedValue(reviewRecord)

    await markKnowledgeReviewChangeNeedsRebase({
      actualContent: 'Current preference',
      actualHash: 'current-hash',
      actor: 'system',
      changeId: reviewRecord.id,
      userId: 'user-1',
    })

    const { data } = mocks.prisma.knowledgeReviewChange.updateMany.mock.calls[0][0]
    expect(data.auditTrail).toHaveLength(2)
  })
})

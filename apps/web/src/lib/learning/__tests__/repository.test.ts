import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isDesktop: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
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

const proposalRecord = {
  id: 'proposal-1',
  userId: 'user-1',
  runId: null,
  status: 'pending',
  title: 'Remember preference',
  type: 'preference',
  confidence: 0.8,
  evidence: { quote: 'Use concise answers' },
  kbPath: 'Preferences/Answers.md',
  operation: 'update',
  proposedContent: 'Use concise answers.',
  currentFileHash: 'hash-old',
  internalSessionId: null,
  trigger: 'agent',
  createdAt: now,
  updatedAt: now,
}

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
    mocks.prisma.$transaction.mockImplementation(async (callback: (transaction: typeof mocks.prisma) => unknown) => callback(mocks.prisma))
  })

  it('maps list results', async () => {
    const { listLearningProposals, listLearningRuns } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeLearningRun.findMany.mockResolvedValue([runRecord])
    mocks.prisma.knowledgeLearningProposal.findMany.mockResolvedValue([proposalRecord])

    await expect(listLearningRuns('user-1')).resolves.toEqual([
      expect.objectContaining({ id: 'run-1', createdAt: now.toISOString() }),
    ])
    await expect(listLearningProposals('user-1')).resolves.toEqual([
      expect.objectContaining({ id: 'proposal-1', evidence: { quote: 'Use concise answers' } }),
    ])
  })

  it('serializes evidence when creating desktop proposals', async () => {
    const { createLearningProposal } = await import('@/lib/learning/repository')
    mocks.isDesktop.mockReturnValue(true)
    mocks.prisma.knowledgeLearningProposal.create.mockResolvedValue({
      ...proposalRecord,
      evidence: JSON.stringify(proposalRecord.evidence),
    })

    await createLearningProposal('user-1', {
      title: proposalRecord.title,
      type: 'preference',
      confidence: proposalRecord.confidence,
      evidence: proposalRecord.evidence,
      kbPath: proposalRecord.kbPath,
      operation: 'update',
      proposedContent: proposalRecord.proposedContent,
      currentFileHash: proposalRecord.currentFileHash,
      trigger: 'agent',
    })

    expect(mocks.prisma.knowledgeLearningProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ evidence: JSON.stringify(proposalRecord.evidence) }),
    })
  })

  it('updates pending proposal statuses atomically', async () => {
    const { updatePendingLearningProposalApplied, updatePendingLearningProposalRejected } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeLearningProposal.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.knowledgeLearningProposal.findUnique.mockResolvedValue(proposalRecord)

    await expect(updatePendingLearningProposalApplied({ proposalId: 'proposal-1', userId: 'user-1', content: 'new' })).resolves.toEqual(
      expect.objectContaining({ id: 'proposal-1' }),
    )
    await expect(updatePendingLearningProposalRejected({ proposalId: 'proposal-1', userId: 'user-1' })).resolves.toEqual(
      expect.objectContaining({ id: 'proposal-1' }),
    )
    expect(mocks.prisma.knowledgeLearningProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'proposal-1', userId: 'user-1', status: 'pending' },
    }))
  })

  it('returns null when a guarded proposal update affects no rows', async () => {
    const { updatePendingLearningProposalApplied } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeLearningProposal.updateMany.mockResolvedValue({ count: 0 })

    await expect(updatePendingLearningProposalApplied({ proposalId: 'proposal-1', userId: 'user-1', content: 'new' })).resolves.toBeNull()
    expect(mocks.prisma.knowledgeLearningProposal.findUnique).not.toHaveBeenCalled()
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

  it('checks learning run ownership', async () => {
    const { learningRunBelongsToUser } = await import('@/lib/learning/repository')
    mocks.prisma.knowledgeLearningRun.findFirst.mockResolvedValue(null)

    await expect(learningRunBelongsToUser({ userId: 'user-1', runId: 'run-other' })).resolves.toBe(false)
    expect(mocks.prisma.knowledgeLearningRun.findFirst).toHaveBeenCalledWith({
      where: { id: 'run-other', userId: 'user-1' },
      select: { id: true },
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

    expect(mocks.prisma.knowledgeReviewChange.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { not: reviewRecord.id } }),
    }))
    expect(mocks.prisma.knowledgeReviewChange.findFirst).not.toHaveBeenCalled()
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
    })).resolves.toEqual(expect.objectContaining({
      id: 'change-2',
      regeneratedFromId: reviewRecord.id,
    }))

    expect(mocks.prisma.knowledgeReviewChange.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ regeneratedFromId: reviewRecord.id, runId: 'run-2' }),
    }))
    expect(mocks.prisma.knowledgeReviewChange.create.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.knowledgeReviewChange.findFirst.mock.invocationCallOrder[0],
    )
    expect(mocks.prisma.knowledgeReviewChange.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'superseded' }),
      where: { id: reviewRecord.id, userId: 'user-1', status: 'needs_rebase' },
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
})

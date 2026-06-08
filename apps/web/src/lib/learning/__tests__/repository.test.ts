import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isDesktop: vi.fn(),
  prisma: {
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
  title: 'Session',
  trigger: 'manual',
  status: 'pending',
  error: null,
  messageCount: 0,
  createdAt: now,
  updatedAt: now,
}

describe('learning repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isDesktop.mockReturnValue(false)
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
})

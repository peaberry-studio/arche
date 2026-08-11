import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureKnowledgeReviewBase: vi.fn(),
  createKnowledgeReviewChange: vi.fn(),
  findLearningRunForUser: vi.fn(),
  getInternalLearningContext: vi.fn(),
}))

vi.mock('@/app/api/internal/learning/auth', () => ({ getInternalLearningContext: mocks.getInternalLearningContext }))
vi.mock('@/lib/learning/service', () => ({
  captureKnowledgeReviewBase: mocks.captureKnowledgeReviewBase,
  createKnowledgeReviewChange: mocks.createKnowledgeReviewChange,
  findLearningRunForUser: mocks.findLearningRunForUser,
}))

import { POST } from '../route'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/internal/learning/proposals', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const validBody = {
  title: 'Remember preference',
  type: 'preference',
  confidence: 0.8,
  evidence: { quote: 'Use concise answers' },
  kbPath: 'Preferences/Answers.md',
  operation: 'update',
  proposedContent: 'Use concise answers.',
  trigger: 'agent',
}

describe('POST /api/internal/learning/proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getInternalLearningContext.mockResolvedValue({ ok: true, userId: 'user-1', slug: 'alice' })
    mocks.captureKnowledgeReviewBase.mockResolvedValue({
      ok: true,
      data: { baseContent: 'Use concise answers.', baseHash: 'sha256:old', initialStatus: 'open' },
    })
    mocks.createKnowledgeReviewChange.mockResolvedValue({ id: 'proposal-1' })
    mocks.findLearningRunForUser.mockResolvedValue(null)
  })

  it('returns auth errors from the internal context', async () => {
    mocks.getInternalLearningContext.mockResolvedValue({ ok: false, error: 'unauthorized', status: 401 })

    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(401)
    expect(mocks.createKnowledgeReviewChange).not.toHaveBeenCalled()
  })

  it('rejects invalid proposal payloads', async () => {
    const response = await POST(makeRequest({ ...validBody, kbPath: '' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' })
  })

  it('rejects run ids that do not belong to the workspace user', async () => {
    mocks.findLearningRunForUser.mockResolvedValue(null)

    const response = await POST(makeRequest({ ...validBody, runId: 'run-other' }))

    expect(response.status).toBe(400)
    expect(mocks.findLearningRunForUser).toHaveBeenCalledWith({ userId: 'user-1', runId: 'run-other' })
    expect(mocks.createKnowledgeReviewChange).not.toHaveBeenCalled()
  })

  it('skips the ownership check when no run id is provided', async () => {
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(200)
    expect(mocks.findLearningRunForUser).not.toHaveBeenCalled()
  })

  it('creates a learning proposal for valid payloads', async () => {
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ proposal: { id: 'proposal-1' } })
    expect(mocks.createKnowledgeReviewChange).toHaveBeenCalledWith('user-1', expect.objectContaining({
      title: 'Remember preference',
      confidence: 0.8,
      evidence: { quote: 'Use concise answers' },
    }))
  })

  it('links a curator replacement only from the authenticated regeneration run', async () => {
    mocks.findLearningRunForUser.mockResolvedValue({
      id: 'run-2',
      regenerationChangeId: 'change-1',
    })

    const response = await POST(makeRequest({ ...validBody, runId: 'run-2' }))

    expect(response.status).toBe(200)
    expect(mocks.createKnowledgeReviewChange).toHaveBeenCalledWith('user-1', expect.objectContaining({
      regeneratedFromId: 'change-1',
      runId: 'run-2',
    }))
  })
})

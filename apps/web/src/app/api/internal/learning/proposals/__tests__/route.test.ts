import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureKnowledgeReviewBase: vi.fn(),
  createKnowledgeReviewChange: vi.fn(),
  findLearningRunForUser: vi.fn(),
  getInternalLearningContext: vi.fn(),
  publishWorkspaceEvent: vi.fn(),
}))

vi.mock('@/app/api/internal/learning/auth', () => ({ getInternalLearningContext: mocks.getInternalLearningContext }))
vi.mock('@/lib/learning/service', () => ({
  captureKnowledgeReviewBase: mocks.captureKnowledgeReviewBase,
  createKnowledgeReviewChange: mocks.createKnowledgeReviewChange,
  findLearningRunForUser: mocks.findLearningRunForUser,
}))
vi.mock('@/lib/runtime/workspace-broadcast', () => ({ publishWorkspaceEvent: mocks.publishWorkspaceEvent }))
vi.mock('@/lib/runtime/workspace-broadcast-events', () => ({
  KNOWLEDGE_PROPOSALS_CHANGED_EVENT: 'knowledge.proposals_changed',
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
    mocks.createKnowledgeReviewChange.mockResolvedValue({ ok: true, change: { id: 'proposal-1' } })
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
    expect(mocks.publishWorkspaceEvent).toHaveBeenCalledWith('user-1', {
      type: 'knowledge.proposals_changed',
    })
  })

  it('does not publish a notification when validation fails', async () => {
    const response = await POST(makeRequest({ ...validBody, kbPath: '' }))

    expect(response.status).toBe(400)
    expect(mocks.publishWorkspaceEvent).not.toHaveBeenCalled()
  })

  it('does not publish a notification when base capture fails', async () => {
    mocks.captureKnowledgeReviewBase.mockResolvedValue({ ok: false, error: 'invalid_request' })

    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(400)
    expect(mocks.publishWorkspaceEvent).not.toHaveBeenCalled()
  })

  it('does not publish a notification when persistence fails', async () => {
    mocks.findLearningRunForUser.mockResolvedValue({ id: 'run-2', regenerationChangeId: null })
    mocks.createKnowledgeReviewChange.mockResolvedValue({
      ok: false,
      error: 'regeneration_source_not_rebaseable',
    })

    const response = await POST(makeRequest({ ...validBody, runId: 'run-2' }))

    expect(response.status).toBe(409)
    expect(mocks.publishWorkspaceEvent).not.toHaveBeenCalled()
  })

  it('attributes to the tool-provided agent when no run id is present', async () => {
    const response = await POST(makeRequest({ ...validBody, agent: 'lines' }))

    expect(response.status).toBe(200)
    expect(mocks.createKnowledgeReviewChange).toHaveBeenCalledWith('user-1', expect.objectContaining({
      author: 'lines',
      agent: 'lines',
    }))
  })

  it('falls back to a neutral persona when no run id or agent is provided', async () => {
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(200)
    expect(mocks.createKnowledgeReviewChange).toHaveBeenCalledWith('user-1', expect.objectContaining({
      author: 'assistant',
      agent: 'assistant',
    }))
  })

  it('attributes a run-linked proposal to the run persona', async () => {
    mocks.findLearningRunForUser.mockResolvedValue({
      id: 'run-2',
      regenerationChangeId: null,
    })

    const response = await POST(makeRequest({ ...validBody, runId: 'run-2', agent: 'lines' }))

    expect(response.status).toBe(200)
    expect(mocks.createKnowledgeReviewChange).toHaveBeenCalledWith('user-1', expect.objectContaining({
      author: 'knowledge-curator',
      agent: 'knowledge-curator',
      runId: 'run-2',
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

  it('maps a regeneration race to a 409 conflict response', async () => {
    mocks.findLearningRunForUser.mockResolvedValue({
      id: 'run-2',
      regenerationChangeId: 'change-1',
    })
    mocks.createKnowledgeReviewChange.mockResolvedValue({
      ok: false,
      error: 'regeneration_source_not_rebaseable',
    })

    const response = await POST(makeRequest({ ...validBody, runId: 'run-2' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'regeneration_source_not_rebaseable' })
  })

  it('accepts a delete operation with empty proposed content', async () => {
    const response = await POST(makeRequest({
      ...validBody,
      operation: 'delete',
      proposedContent: '',
    }))

    expect(response.status).toBe(200)
    expect(mocks.createKnowledgeReviewChange).toHaveBeenCalledWith('user-1', expect.objectContaining({
      operation: 'delete',
      proposedContent: '',
    }))
  })
})

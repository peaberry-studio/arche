import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createLearningProposal: vi.fn(),
  getInternalLearningContext: vi.fn(),
}))

vi.mock('@/app/api/internal/learning/auth', () => ({ getInternalLearningContext: mocks.getInternalLearningContext }))
vi.mock('@/lib/learning/service', () => ({ createLearningProposal: mocks.createLearningProposal }))

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
    mocks.createLearningProposal.mockResolvedValue({ id: 'proposal-1' })
  })

  it('returns auth errors from the internal context', async () => {
    mocks.getInternalLearningContext.mockResolvedValue({ ok: false, error: 'unauthorized', status: 401 })

    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(401)
    expect(mocks.createLearningProposal).not.toHaveBeenCalled()
  })

  it('rejects invalid proposal payloads', async () => {
    const response = await POST(makeRequest({ ...validBody, kbPath: '' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' })
  })

  it('creates a learning proposal for valid payloads', async () => {
    const response = await POST(makeRequest(validBody))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ proposal: { id: 'proposal-1' } })
    expect(mocks.createLearningProposal).toHaveBeenCalledWith('user-1', expect.objectContaining({
      title: 'Remember preference',
      confidence: 0.8,
      evidence: { quote: 'Use concise answers' },
    }))
  })
})

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applyLearningProposal: vi.fn(),
  rejectLearningProposal: vi.fn(),
}))

vi.mock('@/lib/learning/service', () => ({
  applyLearningProposal: mocks.applyLearningProposal,
  rejectLearningProposal: mocks.rejectLearningProposal,
}))

vi.mock('@/lib/runtime/with-auth', () => ({
  withAuth: (_options: unknown, handler: (request: NextRequest, context: { slug: string; user: { id: string } }) => Promise<Response>) => {
    return (request: NextRequest) => handler(request, { slug: 'alice', user: { id: 'user-1' } })
  },
}))

import { POST } from '../route'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/u/alice/learning/proposals', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/u/[slug]/learning/proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.applyLearningProposal.mockResolvedValue({ ok: true, proposal: { id: 'proposal-1' } })
    mocks.rejectLearningProposal.mockResolvedValue({ ok: true, proposal: { id: 'proposal-1' } })
  })

  it('rejects missing or unknown actions without applying', async () => {
    for (const action of [undefined, '', 'delete']) {
      const response = await POST(makeRequest({ proposalId: 'proposal-1', action }))
      expect(response.status).toBe(400)
    }

    expect(mocks.applyLearningProposal).not.toHaveBeenCalled()
    expect(mocks.rejectLearningProposal).not.toHaveBeenCalled()
  })

  it('applies only when action is apply', async () => {
    const response = await POST(makeRequest({ proposalId: 'proposal-1', action: 'apply', content: 'edited' }))

    expect(response.status).toBe(200)
    expect(mocks.applyLearningProposal).toHaveBeenCalledWith({
      userId: 'user-1',
      slug: 'alice',
      proposalId: 'proposal-1',
      content: 'edited',
    })
    expect(mocks.rejectLearningProposal).not.toHaveBeenCalled()
  })

  it('rejects only when action is reject', async () => {
    const response = await POST(makeRequest({ proposalId: 'proposal-1', action: 'reject' }))

    expect(response.status).toBe(200)
    expect(mocks.rejectLearningProposal).toHaveBeenCalledWith({ userId: 'user-1', proposalId: 'proposal-1' })
    expect(mocks.applyLearningProposal).not.toHaveBeenCalled()
  })
})

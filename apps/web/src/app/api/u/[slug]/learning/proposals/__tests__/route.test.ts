import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applyKnowledgeReviewChange: vi.fn(),
  findIdBySlug: vi.fn(),
  regenerateKnowledgeReviewChangeForUser: vi.fn(),
  rebaseKnowledgeReviewChangeForUser: vi.fn(),
  rejectKnowledgeReviewChangeForUser: vi.fn(),
  saveKnowledgeReviewChangeDraft: vi.fn(),
}))

vi.mock('@/lib/learning/service', () => ({
  applyKnowledgeReviewChange: mocks.applyKnowledgeReviewChange,
  regenerateKnowledgeReviewChangeForUser: mocks.regenerateKnowledgeReviewChangeForUser,
  rebaseKnowledgeReviewChangeForUser: mocks.rebaseKnowledgeReviewChangeForUser,
  rejectKnowledgeReviewChangeForUser: mocks.rejectKnowledgeReviewChangeForUser,
  saveKnowledgeReviewChangeDraft: mocks.saveKnowledgeReviewChangeDraft,
}))

vi.mock('@/lib/services/user', () => ({ findIdBySlug: mocks.findIdBySlug }))

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
    mocks.findIdBySlug.mockResolvedValue({ id: 'user-1' })
    mocks.applyKnowledgeReviewChange.mockResolvedValue({ ok: true, change: { id: 'proposal-1' } })
    mocks.rejectKnowledgeReviewChangeForUser.mockResolvedValue({ ok: true, change: { id: 'proposal-1' } })
  })

  it('rejects missing or unknown actions without applying', async () => {
    for (const action of [undefined, '', 'delete']) {
      const response = await POST(makeRequest({ proposalId: 'proposal-1', action }))
      expect(response.status).toBe(400)
    }

    expect(mocks.applyKnowledgeReviewChange).not.toHaveBeenCalled()
    expect(mocks.rejectKnowledgeReviewChangeForUser).not.toHaveBeenCalled()
  })

  it('rejects invalid edited content without applying', async () => {
    // An empty apply is valid now: applying a delete change carries no content.
    for (const content of ['   ', 'x'.repeat(200_001), 42]) {
      const response = await POST(makeRequest({ proposalId: 'proposal-1', action: 'apply', content }))
      expect(response.status).toBe(400)
    }

    expect(mocks.applyKnowledgeReviewChange).not.toHaveBeenCalled()
  })

  it('forwards an empty apply payload for delete changes', async () => {
    const response = await POST(makeRequest({ proposalId: 'proposal-1', action: 'apply', content: '' }))

    expect(response.status).toBe(200)
    expect(mocks.applyKnowledgeReviewChange).toHaveBeenCalledWith({
      actor: 'user-1',
      userId: 'user-1',
      slug: 'alice',
      changeId: 'proposal-1',
      content: '',
    })
  })

  it('rejects non-string proposal ids', async () => {
    const response = await POST(makeRequest({ proposalId: 42, action: 'apply' }))

    expect(response.status).toBe(400)
    expect(mocks.applyKnowledgeReviewChange).not.toHaveBeenCalled()
  })

  it('applies without content using the stored proposal content', async () => {
    const response = await POST(makeRequest({ proposalId: 'proposal-1', action: 'apply' }))

    expect(response.status).toBe(200)
    expect(mocks.applyKnowledgeReviewChange).toHaveBeenCalledWith({
      actor: 'user-1',
      userId: 'user-1',
      slug: 'alice',
      changeId: 'proposal-1',
      content: undefined,
    })
  })

  it('applies only when action is apply', async () => {
    const response = await POST(makeRequest({ proposalId: 'proposal-1', action: 'apply', content: 'edited' }))

    expect(response.status).toBe(200)
    expect(mocks.applyKnowledgeReviewChange).toHaveBeenCalledWith({
      actor: 'user-1',
      userId: 'user-1',
      slug: 'alice',
      changeId: 'proposal-1',
      content: 'edited',
    })
    expect(mocks.rejectKnowledgeReviewChangeForUser).not.toHaveBeenCalled()
  })

  it('rejects only when action is reject', async () => {
    const response = await POST(makeRequest({ proposalId: 'proposal-1', action: 'reject' }))

    expect(response.status).toBe(200)
    expect(mocks.rejectKnowledgeReviewChangeForUser).toHaveBeenCalledWith({ actor: 'user-1', userId: 'user-1', changeId: 'proposal-1' })
    expect(mocks.applyKnowledgeReviewChange).not.toHaveBeenCalled()
  })

  it('acts on the workspace owner records for admin cross-slug requests', async () => {
    mocks.findIdBySlug.mockResolvedValue({ id: 'alice-owner' })

    const response = await POST(makeRequest({ proposalId: 'proposal-1', action: 'apply', content: 'edited' }))

    expect(response.status).toBe(200)
    expect(mocks.applyKnowledgeReviewChange).toHaveBeenCalledWith({
      actor: 'user-1',
      userId: 'alice-owner',
      slug: 'alice',
      changeId: 'proposal-1',
      content: 'edited',
    })
  })

  it('rejects the action when the workspace owner cannot be resolved', async () => {
    mocks.findIdBySlug.mockResolvedValue(null)

    const response = await POST(makeRequest({ proposalId: 'proposal-1', action: 'apply' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'workspace_owner_not_found' })
    expect(mocks.applyKnowledgeReviewChange).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  applyAndPublishKnowledgeReviewChange: vi.fn(),
  regenerateKnowledgeReviewChangeForUser: vi.fn(),
  rebaseKnowledgeReviewChangeForUser: vi.fn(),
  rejectKnowledgeReviewChangeForUser: vi.fn(),
  saveKnowledgeReviewChangeDraft: vi.fn(),
  findIdBySlug: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({ validateDesktopToken: mocks.validateDesktopToken }))
vi.mock('@/lib/learning/service', () => ({
  applyAndPublishKnowledgeReviewChange: mocks.applyAndPublishKnowledgeReviewChange,
  regenerateKnowledgeReviewChangeForUser: mocks.regenerateKnowledgeReviewChangeForUser,
  rebaseKnowledgeReviewChangeForUser: mocks.rebaseKnowledgeReviewChangeForUser,
  rejectKnowledgeReviewChangeForUser: mocks.rejectKnowledgeReviewChangeForUser,
  saveKnowledgeReviewChangeDraft: mocks.saveKnowledgeReviewChangeDraft,
}))
vi.mock('@/lib/services/user', () => ({ findIdBySlug: mocks.findIdBySlug }))

import { POST } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
  sessionId: 's1',
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/u/alice/learning/proposals', {
    method: 'POST',
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/u/[slug]/learning/proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.findIdBySlug.mockResolvedValue({ id: 'owner-1' })
  })

  it('apply returns the change with a publish result', async () => {
    mocks.applyAndPublishKnowledgeReviewChange.mockResolvedValue({
      ok: true,
      change: { id: 'change-1', kbPath: 'Notes/A.md' },
      publish: { ok: true, status: 'published', commitHash: 'abc123' },
    })

    const res = await POST(makeRequest({ action: 'apply', proposalId: 'change-1' }), params('alice'))
    const body = await res.json()

    expect(body).toEqual({
      proposal: { id: 'change-1', kbPath: 'Notes/A.md' },
      publish: { ok: true, status: 'published', commitHash: 'abc123' },
    })
    expect(mocks.applyAndPublishKnowledgeReviewChange).toHaveBeenCalledWith({
      actor: 'u1',
      changeId: 'change-1',
      content: undefined,
      slug: 'alice',
      userId: 'owner-1',
    })
  })

  it('apply returns the publish failure with the change still applied', async () => {
    mocks.applyAndPublishKnowledgeReviewChange.mockResolvedValue({
      ok: true,
      change: { id: 'change-1', kbPath: 'Notes/A.md', status: 'applied' },
      publish: { ok: false, status: 'push_rejected', message: 'fetch first' },
    })

    const res = await POST(makeRequest({ action: 'apply', proposalId: 'change-1' }), params('alice'))
    const body = await res.json()

    expect(body.proposal).toEqual({ id: 'change-1', kbPath: 'Notes/A.md', status: 'applied' })
    expect(body.publish).toEqual({ ok: false, status: 'push_rejected', message: 'fetch first' })
  })

  it('returns apply errors as a 400 error response', async () => {
    mocks.applyAndPublishKnowledgeReviewChange.mockResolvedValue({ ok: false, error: 'needs_rebase' })

    const res = await POST(makeRequest({ action: 'apply', proposalId: 'change-1' }), params('alice'))

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'needs_rebase' })
    expect(mocks.applyAndPublishKnowledgeReviewChange).toHaveBeenCalledTimes(1)
  })

  it('non-apply actions return the change without a publish result', async () => {
    mocks.rejectKnowledgeReviewChangeForUser.mockResolvedValue({ ok: true, change: { id: 'change-1' } })

    const res = await POST(makeRequest({ action: 'reject', proposalId: 'change-1' }), params('alice'))
    const body = await res.json()

    expect(body).toEqual({ proposal: { id: 'change-1' } })
    expect(body.publish).toBeUndefined()
  })
})
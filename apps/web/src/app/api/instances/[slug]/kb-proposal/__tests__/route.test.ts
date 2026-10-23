import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(), origin: vi.fn(), approve: vi.fn(), proposal: vi.fn(), sync: vi.fn(), audit: vi.fn(), mark: vi.fn(),
}))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: () => ({ csrf: true }) }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: () => false }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.origin }))
vi.mock('@/lib/runtime/paths', () => ({ getKbContentRoot: () => '/kb.git' }))
vi.mock('@/lib/git/kb-publication', () => ({ approveKbProposal: mocks.approve, getKbProposal: mocks.proposal, kbGit: async () => Buffer.from('reviewed') }))
vi.mock('@/lib/git/kb-github-broker', () => ({ syncKbGithub: mocks.sync }))
vi.mock('@/lib/services/audit', () => ({ createEventStrict: mocks.audit }))
vi.mock('@/lib/learning/service', () => ({ markKnowledgeReviewChangesPublished: mocks.mark }))
vi.mock('@/lib/services/user', () => ({ findIdBySlug: async () => ({ id: 'alice-id' }) }))

import { GET, POST } from '@/app/api/instances/[slug]/kb-proposal/route'

const commit = 'a'.repeat(40)
const base = 'b'.repeat(40)
const proposal = { slug: 'alice', ref: 'refs/heads/proposals/alice/pending', commit, base, paths: ['note.md'], diff: '+reviewed' }
const params = { params: Promise.resolve({ slug: 'alice' }) }
function request(body: unknown = { commit, base }) {
  return new NextRequest('http://localhost/api/instances/alice/kb-proposal', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'admin-id', slug: 'admin', role: 'ADMIN' }, sessionId: 'session' })
  mocks.origin.mockReturnValue({ ok: true })
  mocks.proposal.mockResolvedValue(proposal)
  mocks.approve.mockResolvedValue(proposal)
  mocks.sync.mockResolvedValue({ ok: true, configured: true, incoming: false })
})

describe('KB proposal review boundary', () => {
  it('requires an authenticated administrator for publication, including the workspace owner', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await POST(request(), params)).status).toBe(401)
    mocks.session.mockResolvedValue({ user: { id: 'alice-id', slug: 'alice', role: 'USER' }, sessionId: 'session' })
    expect((await POST(request(), params)).status).toBe(403)
    expect(mocks.approve).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
  })
  it('rejects cross-tenant review and forged origins', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'bob-id', slug: 'bob', role: 'USER' }, sessionId: 'session' })
    expect((await GET(request(), params)).status).toBe(403)
    mocks.session.mockResolvedValue({ user: { id: 'admin-id', slug: 'admin', role: 'ADMIN' }, sessionId: 'session' })
    mocks.origin.mockReturnValue({ ok: false })
    expect((await POST(request(), params)).status).toBe(403)
    expect(mocks.approve).not.toHaveBeenCalled()
  })
  it('returns an immutable diff and tells owners that approval is required', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'alice-id', slug: 'alice', role: 'USER' }, sessionId: 'session' })
    const response = await GET(request(), params)
    expect(await response.json()).toEqual({ proposal, canApprove: false })
  })
  it.each([{ commit }, { commit: 'HEAD', base }, { commit, base: '--all' }])('rejects malformed approval %j', async (body) => {
    expect((await POST(request(body), params)).status).toBe(400)
    expect(mocks.approve).not.toHaveBeenCalled()
  })
  it('binds approval to slug, commit and base and audits paths before exporting from the broker', async () => {
    const response = await POST(request(), params)
    expect(response.status).toBe(200)
    expect(mocks.approve).toHaveBeenCalledWith('/kb.git', 'alice', commit, base)
    expect(mocks.audit).toHaveBeenCalledWith({ actorUserId: 'admin-id', action: 'kb.proposal_approved', metadata: { slug: 'alice', ref: proposal.ref, commit, base, paths: ['note.md'] } })
    expect(mocks.sync).toHaveBeenCalledWith('push', 'admin-id')
    expect(mocks.approve.mock.invocationCallOrder[0]).toBeLessThan(mocks.sync.mock.invocationCallOrder[0])
  })
  it('does not export or mark changes published when approval races with another change', async () => {
    mocks.approve.mockRejectedValue(new Error('proposal_changed'))
    expect((await POST(request(), params)).status).toBe(409)
    expect(mocks.sync).not.toHaveBeenCalled()
    expect(mocks.mark).not.toHaveBeenCalled()
  })
  it('reports local publication separately from a failed GitHub export', async () => {
    mocks.sync.mockResolvedValue({ ok: false, error: 'GitHub unavailable' })
    const response = await POST(request(), params)
    expect(await response.json()).toMatchObject({ ok: true, status: 'published', githubStatus: 'error' })
  })
  it('blocks publication if approval intent cannot be audited', async () => {
    mocks.audit.mockRejectedValue(new Error('audit unavailable'))
    expect((await POST(request(), params)).status).toBe(409)
    expect(mocks.approve).not.toHaveBeenCalled()
  })
  it('allows an administrator to retry exporting approved main without approving a new proposal', async () => {
    const response = await POST(request({ action: 'export' }), params)
    expect(response.status).toBe(200)
    expect(mocks.approve).not.toHaveBeenCalled()
    expect(mocks.sync).toHaveBeenCalledWith('push', 'admin-id')
  })
  it('downloads only the exact reviewed file as an attachment', async () => {
    const url = `http://localhost/api/instances/alice/kb-proposal?commit=${commit}&path=note.md`
    const response = await GET(new NextRequest(url), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('attachment;')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('reviewed')
    expect((await GET(new NextRequest(`${url.replace(commit, base)}`), params)).status).toBe(409)
    expect((await GET(new NextRequest(`${url.replace('note.md', '..%2Fconfig')}`), params)).status).toBe(409)
  })
})

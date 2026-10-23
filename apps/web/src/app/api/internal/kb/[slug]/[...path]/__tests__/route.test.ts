import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ credentials: vi.fn(), serve: vi.fn(), audit: vi.fn() }))
vi.mock('@/lib/services/audit', () => ({ createEventStrict: mocks.audit }))
vi.mock('@/lib/git/kb-http-backend', () => ({ serveKbGit: mocks.serve }))
vi.mock('@/lib/runtime/paths', () => ({ getKbContentRoot: () => '/kb-content' }))
vi.mock('@/lib/services', () => ({ instanceService: { findCredentialsBySlug: mocks.credentials } }))
vi.mock('@/lib/spawner/crypto', () => ({ decryptPassword: (value: string) => value }))

import { GET, POST } from '@/app/api/internal/kb/[slug]/[...path]/route'

const params = { params: Promise.resolve({ slug: 'alice', path: ['info', 'refs'] }) }
const auth = `Basic ${Buffer.from('opencode:fixture').toString('base64')}`

describe('workspace KB broker authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.credentials.mockResolvedValue({ serverPassword: 'fixture', status: 'running' })
    mocks.serve.mockImplementation(async () => new Response('git-protocol'))
  })

  it.each([undefined, 'Bearer wrong', `Basic ${Buffer.from('opencode:invalid').toString('base64')}`])('rejects invalid credentials', async (authorization) => {
    const response = await GET(new Request('http://localhost/', { headers: authorization ? { authorization } : {} }), params)
    expect(response.status).toBe(401)
    expect(mocks.serve).not.toHaveBeenCalled()
  })

  it('rejects credentials for a stopped workspace', async () => {
    mocks.credentials.mockResolvedValue({ serverPassword: 'fixture', status: 'stopped' })
    expect((await GET(new Request('http://localhost/', { headers: { authorization: auth } }), params)).status).toBe(401)
    expect(mocks.serve).not.toHaveBeenCalled()
  })

  it('accepts the current workspace credential and audits publication', async () => {
    const event = { ref: 'refs/heads/proposals/alice/pending', commit: 'a'.repeat(40), paths: ['note.md'] }
    mocks.serve.mockImplementation(async (_request, _repo, _path, _slug, accepted) => { await accepted(event); return new Response('git-protocol') })
    const request = new Request('http://localhost/', { method: 'POST', headers: { authorization: auth } })
    expect((await POST(request, { params: Promise.resolve({ slug: 'alice', path: ['git-receive-pack'] }) })).status).toBe(200)
    expect(mocks.serve).toHaveBeenCalledWith(request, '/kb-content', 'git-receive-pack', 'alice', expect.any(Function))
    expect(mocks.audit).toHaveBeenCalledWith({ action: 'kb.workspace_push', metadata: { slug: 'alice', ...event } })
  })
})

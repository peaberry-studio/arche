import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  auditEvent: vi.fn(),
  readSkillBundle: vi.fn(),
  createSkillArchive: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/skills/skill-store', () => ({ readSkillBundle: mocks.readSkillBundle }))
vi.mock('@/lib/skills/skill-zip', () => ({ createSkillArchive: mocks.createSkillArchive }))

import { GET } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

function makeRequest() {
  return new NextRequest('http://localhost/api/u/admin/skills/my-skill/export', { method: 'GET' })
}

function params(slug: string, name: string) {
  return { params: Promise.resolve({ slug, name }) }
}

describe('GET /api/u/[slug]/skills/[name]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
  })

  it('returns zip archive on success', async () => {
    const bundle = { skill: { frontmatter: { name: 'my-skill' } }, files: [] }
    const zipBytes = new Uint8Array([80, 75, 3, 4])
    mocks.readSkillBundle.mockResolvedValue({ ok: true, data: bundle, hash: 'h1' })
    mocks.createSkillArchive.mockReturnValue(zipBytes)

    const res = await GET(makeRequest(), params('admin', 'my-skill'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toContain('my-skill.zip')
    expect(mocks.auditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'skill.exported' }),
    )
  })

  it('returns 404 when skill not found', async () => {
    mocks.readSkillBundle.mockResolvedValue({ ok: false, error: 'not_found' })
    const res = await GET(makeRequest(), params('admin', 'nonexistent'))
    expect(res.status).toBe(404)
  })

  it('returns 503 when kb unavailable', async () => {
    mocks.readSkillBundle.mockResolvedValue({ ok: false, error: 'kb_unavailable' })
    const res = await GET(makeRequest(), params('admin', 'my-skill'))
    expect(res.status).toBe(503)
  })

  it('returns 500 for read_failed', async () => {
    mocks.readSkillBundle.mockResolvedValue({ ok: false, error: 'read_failed' })
    const res = await GET(makeRequest(), params('admin', 'my-skill'))
    expect(res.status).toBe(500)
  })

  it('returns 401 when not authenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await GET(makeRequest(), params('admin', 'my-skill'))
    expect(res.status).toBe(401)
  })
})

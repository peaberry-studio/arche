import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetRuntimeCapabilities,
  mockIsDesktop,
  mockGetSession,
  mockValidateSameOrigin,
  mockValidateDesktopToken,
  mockAuditEvent,
  mockImportSkillArchive,
  mockReadSkill,
  mockParseSkillArchive,
} = vi.hoisted(() => ({
  mockGetRuntimeCapabilities: vi.fn(),
  mockIsDesktop: vi.fn(),
  mockGetSession: vi.fn(),
  mockValidateSameOrigin: vi.fn(),
  mockValidateDesktopToken: vi.fn(),
  mockAuditEvent: vi.fn(),
  mockImportSkillArchive: vi.fn(),
  mockReadSkill: vi.fn(),
  mockParseSkillArchive: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mockGetRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mockIsDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mockValidateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-desktop-token',
  validateDesktopToken: mockValidateDesktopToken,
}))
vi.mock('@/lib/auth', () => ({ auditEvent: mockAuditEvent }))
vi.mock('@/lib/skills/skill-store', () => ({
  importSkillArchive: mockImportSkillArchive,
  readSkill: mockReadSkill,
}))
vi.mock('@/lib/skills/skill-zip', () => ({
  MAX_SKILL_ARCHIVE_BYTES: 1024 * 1024,
  parseSkillArchive: mockParseSkillArchive,
}))

import { POST } from '../route'

const ADMIN_SESSION = {
  user: { id: 'u1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 's1',
}

const FAKE_ARCHIVE = {
  skill: { frontmatter: { name: 'my-skill', description: 'A skill' }, body: 'body' },
  files: [{ path: 'skill.md', content: new Uint8Array([1, 2, 3]) }],
}

function makeImportRequest(fields: Record<string, string | File>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value)
  }
  return new NextRequest('http://localhost/api/u/admin/skills/import', {
    method: 'POST',
    body: formData,
    headers: { Origin: 'http://localhost' },
  })
}

describe('POST /api/u/[slug]/skills/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntimeCapabilities.mockReturnValue({ csrf: false })
    mockIsDesktop.mockReturnValue(false)
    mockGetSession.mockResolvedValue(ADMIN_SESSION)
    mockValidateSameOrigin.mockReturnValue({ ok: true })
    mockParseSkillArchive.mockReturnValue({ ok: true, archive: FAKE_ARCHIVE })
    mockImportSkillArchive.mockResolvedValue({ ok: true, hash: 'h1' })
    mockReadSkill.mockResolvedValue({
      ok: true,
      data: { name: 'my-skill', description: 'A skill', body: 'body', assignedAgentIds: [], hasResources: false, resourcePaths: [] },
    })
  })

  it('imports a skill archive successfully', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'skill.zip', { type: 'application/zip' })
    const req = makeImportRequest({
      file,
      assignedAgentIds: '["agent-1"]',
    })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.skill.name).toBe('my-skill')
    expect(body.hash).toBe('h1')
    expect(mockAuditEvent).toHaveBeenCalled()
  })

  it('rejects non-admin', async () => {
    mockGetSession.mockResolvedValue({
      ...ADMIN_SESSION,
      user: { ...ADMIN_SESSION.user, role: 'USER' },
    })
    const file = new File([new Uint8Array([1])], 'skill.zip')
    const req = makeImportRequest({ file, assignedAgentIds: '[]' })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(res.status).toBe(403)
  })

  it('rejects missing file', async () => {
    const req = makeImportRequest({ assignedAgentIds: '[]' })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(res.status).toBe(400)
  })

  it('rejects invalid assignedAgentIds', async () => {
    const file = new File([new Uint8Array([1])], 'skill.zip')
    const req = makeImportRequest({ file, assignedAgentIds: 'not-json' })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    const body = await res.json()
    expect(body.error).toBe('invalid_assigned_agents')
  })

  it('rejects non-array assignedAgentIds', async () => {
    const file = new File([new Uint8Array([1])], 'skill.zip')
    const req = makeImportRequest({ file, assignedAgentIds: '"string"' })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(res.status).toBe(400)
  })

  it('rejects empty strings in assignedAgentIds', async () => {
    const file = new File([new Uint8Array([1])], 'skill.zip')
    const req = makeImportRequest({ file, assignedAgentIds: '[""]' })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(res.status).toBe(400)
  })

  it('handles archive parse error', async () => {
    mockParseSkillArchive.mockReturnValue({ ok: false, error: 'invalid_archive' })
    const file = new File([new Uint8Array([1])], 'skill.zip')
    const req = makeImportRequest({ file, assignedAgentIds: '[]' })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(res.status).toBe(400)
  })

  it('handles archive_too_large from parser', async () => {
    mockParseSkillArchive.mockReturnValue({ ok: false, error: 'archive_too_large' })
    const file = new File([new Uint8Array([1])], 'skill.zip')
    const req = makeImportRequest({ file, assignedAgentIds: '[]' })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(res.status).toBe(413)
  })

  it('handles import conflict', async () => {
    mockImportSkillArchive.mockResolvedValue({ ok: false, error: 'conflict' })
    const file = new File([new Uint8Array([1])], 'skill.zip')
    const req = makeImportRequest({ file, assignedAgentIds: '[]' })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(res.status).toBe(409)
  })

  it('handles kb_unavailable', async () => {
    mockImportSkillArchive.mockResolvedValue({ ok: false, error: 'kb_unavailable' })
    const file = new File([new Uint8Array([1])], 'skill.zip')
    const req = makeImportRequest({ file, assignedAgentIds: '[]' })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(res.status).toBe(503)
  })

  it('handles read failure after import', async () => {
    mockReadSkill.mockResolvedValue({ ok: false, error: 'read_failed' })
    const file = new File([new Uint8Array([1])], 'skill.zip')
    const req = makeImportRequest({ file, assignedAgentIds: '[]' })
    const res = await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(res.status).toBe(500)
  })

  it('passes expectedHash from form data', async () => {
    const file = new File([new Uint8Array([1])], 'skill.zip')
    const req = makeImportRequest({ file, assignedAgentIds: '[]', expectedHash: 'abc' })
    await POST(req, { params: Promise.resolve({ slug: 'admin' }) })
    expect(mockImportSkillArchive).toHaveBeenCalledWith(
      expect.objectContaining({ expectedHash: 'abc' }),
    )
  })
})

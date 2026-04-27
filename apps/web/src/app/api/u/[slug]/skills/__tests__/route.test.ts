import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(),
  isDesktop: vi.fn(),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(),
  validateDesktopToken: vi.fn(),
  auditEvent: vi.fn(),
  listSkills: vi.fn(),
  saveSkillDocument: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({
  getRuntimeCapabilities: mocks.getRuntimeCapabilities,
}))

vi.mock('@/lib/runtime/mode', () => ({
  isDesktop: mocks.isDesktop,
}))

vi.mock('@/lib/runtime/session', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/lib/csrf', () => ({
  validateSameOrigin: mocks.validateSameOrigin,
}))

vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))

vi.mock('@/lib/auth', () => ({
  auditEvent: mocks.auditEvent,
}))

vi.mock('@/lib/skills/skill-store', () => ({
  listSkills: mocks.listSkills,
  saveSkillDocument: mocks.saveSkillDocument,
}))

const adminSession = {
  user: { id: 'admin-1', email: 'admin@test.com', slug: 'alice', role: 'ADMIN' },
  sessionId: 'session-1',
}

const memberSession = {
  user: { id: 'user-1', email: 'user@test.com', slug: 'alice', role: 'USER' },
  sessionId: 'session-2',
}

const sampleSkill = {
  assignedAgentIds: ['agent-1'],
  description: 'A test skill',
  hasResources: false,
  name: 'test-skill',
  resourcePaths: [],
}

function buildParams(slug = 'alice') {
  return { params: Promise.resolve({ slug }) }
}

function buildPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/u/alice/skills', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
    body: JSON.stringify(body),
  })
}

describe('/api/u/[slug]/skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false })
    mocks.isDesktop.mockReturnValue(false)
    mocks.getSession.mockResolvedValue(adminSession)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.auditEvent.mockResolvedValue(undefined)
  })

  describe('GET', () => {
    it('lists skills', async () => {
      mocks.listSkills.mockResolvedValue({
        ok: true,
        data: [sampleSkill],
        hash: 'abc123',
      })

      const { GET } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills', { method: 'GET' })
      const response = await GET(request, buildParams())

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json).toEqual({
        skills: [sampleSkill],
        hash: 'abc123',
      })
    })

    it('returns 503 when kb_unavailable', async () => {
      mocks.listSkills.mockResolvedValue({
        ok: false,
        error: 'kb_unavailable',
      })

      const { GET } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills', { method: 'GET' })
      const response = await GET(request, buildParams())

      expect(response.status).toBe(503)
      const json = await response.json()
      expect(json).toEqual({ error: 'kb_unavailable' })
    })

    it('returns 500 for other listSkills errors', async () => {
      mocks.listSkills.mockResolvedValue({
        ok: false,
        error: 'read_failed',
      })

      const { GET } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills', { method: 'GET' })
      const response = await GET(request, buildParams())

      expect(response.status).toBe(500)
      const json = await response.json()
      expect(json).toEqual({ error: 'read_failed' })
    })

    it('returns 401 when session is missing', async () => {
      mocks.getSession.mockResolvedValue(null)

      const { GET } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills', { method: 'GET' })
      const response = await GET(request, buildParams())

      expect(response.status).toBe(401)
    })
  })

  describe('POST', () => {
    it('creates a skill (admin only)', async () => {
      mocks.saveSkillDocument.mockResolvedValue({ ok: true, hash: 'new-hash' })
      mocks.listSkills.mockResolvedValue({
        ok: true,
        data: [sampleSkill],
        hash: 'new-hash',
      })

      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: '# Test Skill\nContent here',
        assignedAgentIds: ['agent-1'],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(201)
      const json = await response.json()
      expect(json).toEqual({ skill: sampleSkill, hash: 'new-hash' })

      expect(mocks.saveSkillDocument).toHaveBeenCalledWith({
        mode: 'create',
        name: 'test-skill',
        description: 'A test skill',
        body: '# Test Skill\nContent here',
        assignedAgentIds: ['agent-1'],
        expectedHash: undefined,
      })

      expect(mocks.auditEvent).toHaveBeenCalledWith({
        actorUserId: 'admin-1',
        action: 'skill.created',
        metadata: { slug: 'alice', skillName: 'test-skill' },
      })
    })

    it('passes expectedHash when provided', async () => {
      mocks.saveSkillDocument.mockResolvedValue({ ok: true, hash: 'new-hash' })
      mocks.listSkills.mockResolvedValue({
        ok: true,
        data: [sampleSkill],
        hash: 'new-hash',
      })

      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: [],
        expectedHash: 'prev-hash',
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(201)
      expect(mocks.saveSkillDocument).toHaveBeenCalledWith(
        expect.objectContaining({ expectedHash: 'prev-hash' })
      )
    })

    it('rejects non-admin users with 403', async () => {
      mocks.getSession.mockResolvedValue(memberSession)

      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(403)
      const json = await response.json()
      expect(json).toEqual({ error: 'forbidden' })
      expect(mocks.saveSkillDocument).not.toHaveBeenCalled()
    })

    it('returns 400 for invalid JSON body', async () => {
      const { POST } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
        },
        body: 'not json{',
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_json' })
    })

    it('returns 400 for missing name', async () => {
      const { POST } = await import('../route')
      const request = buildPostRequest({
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_name' })
    })

    it('returns 400 for name with invalid characters', async () => {
      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'Invalid Name!',
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_name' })
    })

    it('returns 400 for name exceeding 64 characters', async () => {
      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'a'.repeat(65),
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_name' })
    })

    it('returns 400 for missing description', async () => {
      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        body: 'content',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_description' })
    })

    it('returns 400 for description exceeding 1024 characters', async () => {
      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'x'.repeat(1025),
        body: 'content',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_description' })
    })

    it('returns 400 for missing body', async () => {
      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_body' })
    })

    it('returns 400 for non-string body field', async () => {
      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: 123,
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_body' })
    })

    it('returns 400 for invalid assignedAgentIds', async () => {
      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: 'not-an-array',
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_assigned_agents' })
    })

    it('returns 400 for assignedAgentIds with empty strings', async () => {
      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: ['valid', ''],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_assigned_agents' })
    })

    it('returns 409 for duplicate skill name', async () => {
      mocks.saveSkillDocument.mockResolvedValue({
        ok: false,
        error: 'skill_exists',
      })

      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(409)
      const json = await response.json()
      expect(json).toEqual({ error: 'skill_exists' })
    })

    it('returns 409 for hash conflict', async () => {
      mocks.saveSkillDocument.mockResolvedValue({
        ok: false,
        error: 'conflict',
      })

      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(409)
      const json = await response.json()
      expect(json).toEqual({ error: 'conflict' })
    })

    it('returns 400 for unknown_agent error from saveSkillDocument', async () => {
      mocks.saveSkillDocument.mockResolvedValue({
        ok: false,
        error: 'unknown_agent',
      })

      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: ['nonexistent-agent'],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'unknown_agent' })
    })

    it('returns 503 when kb is unavailable during creation', async () => {
      mocks.saveSkillDocument.mockResolvedValue({
        ok: false,
        error: 'kb_unavailable',
      })

      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(503)
      const json = await response.json()
      expect(json).toEqual({ error: 'kb_unavailable' })
    })

    it('returns 500 when listSkills fails after successful creation', async () => {
      mocks.saveSkillDocument.mockResolvedValue({ ok: true, hash: 'new-hash' })
      mocks.listSkills.mockResolvedValue({
        ok: false,
        error: 'read_failed',
      })

      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(500)
      const json = await response.json()
      expect(json).toEqual({ error: 'read_failed' })
    })

    it('returns 500 when created skill is not found in list', async () => {
      mocks.saveSkillDocument.mockResolvedValue({ ok: true, hash: 'new-hash' })
      mocks.listSkills.mockResolvedValue({
        ok: true,
        data: [],
        hash: 'new-hash',
      })

      const { POST } = await import('../route')
      const request = buildPostRequest({
        name: 'test-skill',
        description: 'A test skill',
        body: 'content',
        assignedAgentIds: [],
      })
      const response = await POST(request, buildParams())

      expect(response.status).toBe(500)
      const json = await response.json()
      expect(json).toEqual({ error: 'read_failed' })
    })
  })
})

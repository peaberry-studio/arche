import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(),
  isDesktop: vi.fn(),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(),
  validateDesktopToken: vi.fn(),
  auditEvent: vi.fn(),
  readSkill: vi.fn(),
  saveSkillDocument: vi.fn(),
  deleteSkill: vi.fn(),
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
  readSkill: mocks.readSkill,
  saveSkillDocument: mocks.saveSkillDocument,
  deleteSkill: mocks.deleteSkill,
}))

const adminSession = {
  user: { id: 'admin-1', email: 'admin@test.com', slug: 'alice', role: 'ADMIN' },
  sessionId: 'session-1',
}

const memberSession = {
  user: { id: 'user-1', email: 'user@test.com', slug: 'alice', role: 'USER' },
  sessionId: 'session-2',
}

const sampleSkillDetail = {
  assignedAgentIds: ['agent-1'],
  body: '# Test Skill\nContent here',
  description: 'A test skill',
  hasResources: false,
  name: 'test-skill',
  resourcePaths: [],
}

function buildParams(name = 'test-skill', slug = 'alice') {
  return { params: Promise.resolve({ name, slug }) }
}

function buildPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/u/alice/skills/test-skill', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
    body: JSON.stringify(body),
  })
}

function buildDeleteRequest(body?: unknown) {
  const init: RequestInit = {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  return new NextRequest('http://localhost/api/u/alice/skills/test-skill', init)
}

describe('/api/u/[slug]/skills/[name]', () => {
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
    it('returns skill detail', async () => {
      mocks.readSkill.mockResolvedValue({
        ok: true,
        data: sampleSkillDetail,
        hash: 'abc123',
      })

      const { GET } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills/test-skill', {
        method: 'GET',
      })
      const response = await GET(request, buildParams())

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json).toEqual({
        skill: sampleSkillDetail,
        hash: 'abc123',
      })
    })

    it('returns 404 for missing skill', async () => {
      mocks.readSkill.mockResolvedValue({
        ok: false,
        error: 'not_found',
      })

      const { GET } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills/nonexistent', {
        method: 'GET',
      })
      const response = await GET(request, buildParams('nonexistent'))

      expect(response.status).toBe(404)
      const json = await response.json()
      expect(json).toEqual({ error: 'not_found' })
    })

    it('returns 503 when kb is unavailable', async () => {
      mocks.readSkill.mockResolvedValue({
        ok: false,
        error: 'kb_unavailable',
      })

      const { GET } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills/test-skill', {
        method: 'GET',
      })
      const response = await GET(request, buildParams())

      expect(response.status).toBe(503)
      const json = await response.json()
      expect(json).toEqual({ error: 'kb_unavailable' })
    })

    it('returns 500 for other readSkill errors', async () => {
      mocks.readSkill.mockResolvedValue({
        ok: false,
        error: 'read_failed',
      })

      const { GET } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills/test-skill', {
        method: 'GET',
      })
      const response = await GET(request, buildParams())

      expect(response.status).toBe(500)
      const json = await response.json()
      expect(json).toEqual({ error: 'read_failed' })
    })

    it('returns 401 when session is missing', async () => {
      mocks.getSession.mockResolvedValue(null)

      const { GET } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills/test-skill', {
        method: 'GET',
      })
      const response = await GET(request, buildParams())

      expect(response.status).toBe(401)
    })
  })

  describe('PATCH', () => {
    it('updates skill (admin only)', async () => {
      mocks.readSkill
        .mockResolvedValueOnce({
          ok: true,
          data: sampleSkillDetail,
          hash: 'old-hash',
        })
        .mockResolvedValueOnce({
          ok: true,
          data: { ...sampleSkillDetail, description: 'Updated description' },
          hash: 'new-hash',
        })
      mocks.saveSkillDocument.mockResolvedValue({ ok: true, hash: 'new-hash' })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({
        description: 'Updated description',
      })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json).toEqual({
        skill: { ...sampleSkillDetail, description: 'Updated description' },
        hash: 'new-hash',
      })

      expect(mocks.saveSkillDocument).toHaveBeenCalledWith({
        mode: 'update',
        name: 'test-skill',
        description: 'Updated description',
        body: sampleSkillDetail.body,
        assignedAgentIds: sampleSkillDetail.assignedAgentIds,
        expectedHash: undefined,
      })

      expect(mocks.auditEvent).toHaveBeenCalledWith({
        actorUserId: 'admin-1',
        action: 'skill.updated',
        metadata: { slug: 'alice', skillName: 'test-skill' },
      })
    })

    it('uses existing values for fields not provided', async () => {
      mocks.readSkill
        .mockResolvedValueOnce({
          ok: true,
          data: sampleSkillDetail,
          hash: 'old-hash',
        })
        .mockResolvedValueOnce({
          ok: true,
          data: sampleSkillDetail,
          hash: 'new-hash',
        })
      mocks.saveSkillDocument.mockResolvedValue({ ok: true, hash: 'new-hash' })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({})
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(200)
      expect(mocks.saveSkillDocument).toHaveBeenCalledWith({
        mode: 'update',
        name: 'test-skill',
        description: sampleSkillDetail.description,
        body: sampleSkillDetail.body,
        assignedAgentIds: sampleSkillDetail.assignedAgentIds,
        expectedHash: undefined,
      })
    })

    it('passes expectedHash when provided', async () => {
      mocks.readSkill
        .mockResolvedValueOnce({
          ok: true,
          data: sampleSkillDetail,
          hash: 'old-hash',
        })
        .mockResolvedValueOnce({
          ok: true,
          data: sampleSkillDetail,
          hash: 'new-hash',
        })
      mocks.saveSkillDocument.mockResolvedValue({ ok: true, hash: 'new-hash' })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({
        description: 'Updated',
        expectedHash: 'old-hash',
      })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(200)
      expect(mocks.saveSkillDocument).toHaveBeenCalledWith(
        expect.objectContaining({ expectedHash: 'old-hash' })
      )
    })

    it('rejects non-admin users with 403', async () => {
      mocks.getSession.mockResolvedValue(memberSession)

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ description: 'Updated' })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(403)
      const json = await response.json()
      expect(json).toEqual({ error: 'forbidden' })
      expect(mocks.saveSkillDocument).not.toHaveBeenCalled()
    })

    it('returns 400 for invalid JSON body', async () => {
      const { PATCH } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills/test-skill', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
        },
        body: 'not json{',
      })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_json' })
    })

    it('returns 404 when skill does not exist', async () => {
      mocks.readSkill.mockResolvedValue({
        ok: false,
        error: 'not_found',
      })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ description: 'Updated' })
      const response = await PATCH(request, buildParams('nonexistent'))

      expect(response.status).toBe(404)
      const json = await response.json()
      expect(json).toEqual({ error: 'not_found' })
      expect(mocks.saveSkillDocument).not.toHaveBeenCalled()
    })

    it('returns 400 for empty description', async () => {
      mocks.readSkill.mockResolvedValueOnce({
        ok: true,
        data: sampleSkillDetail,
        hash: 'old-hash',
      })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ description: '   ' })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_description' })
    })

    it('returns 400 for description exceeding 1024 characters', async () => {
      mocks.readSkill.mockResolvedValueOnce({
        ok: true,
        data: sampleSkillDetail,
        hash: 'old-hash',
      })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ description: 'x'.repeat(1025) })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_description' })
    })

    it('returns 400 for non-string description', async () => {
      mocks.readSkill.mockResolvedValueOnce({
        ok: true,
        data: sampleSkillDetail,
        hash: 'old-hash',
      })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ description: 123 })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_description' })
    })

    it('returns 400 for non-string body', async () => {
      mocks.readSkill.mockResolvedValueOnce({
        ok: true,
        data: sampleSkillDetail,
        hash: 'old-hash',
      })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ body: 123 })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_body' })
    })

    it('returns 400 for invalid assignedAgentIds', async () => {
      mocks.readSkill.mockResolvedValueOnce({
        ok: true,
        data: sampleSkillDetail,
        hash: 'old-hash',
      })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ assignedAgentIds: 'not-an-array' })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'invalid_assigned_agents' })
    })

    it('returns 409 for conflict error from saveSkillDocument', async () => {
      mocks.readSkill.mockResolvedValueOnce({
        ok: true,
        data: sampleSkillDetail,
        hash: 'old-hash',
      })
      mocks.saveSkillDocument.mockResolvedValue({
        ok: false,
        error: 'conflict',
      })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ description: 'Updated' })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(409)
      const json = await response.json()
      expect(json).toEqual({ error: 'conflict' })
    })

    it('returns 404 for not_found error from saveSkillDocument', async () => {
      mocks.readSkill.mockResolvedValueOnce({
        ok: true,
        data: sampleSkillDetail,
        hash: 'old-hash',
      })
      mocks.saveSkillDocument.mockResolvedValue({
        ok: false,
        error: 'not_found',
      })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ description: 'Updated' })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(404)
      const json = await response.json()
      expect(json).toEqual({ error: 'not_found' })
    })

    it('returns 400 for unknown_agent error from saveSkillDocument', async () => {
      mocks.readSkill.mockResolvedValueOnce({
        ok: true,
        data: sampleSkillDetail,
        hash: 'old-hash',
      })
      mocks.saveSkillDocument.mockResolvedValue({
        ok: false,
        error: 'unknown_agent',
      })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ assignedAgentIds: ['nonexistent'] })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json).toEqual({ error: 'unknown_agent' })
    })

    it('returns 503 when kb is unavailable during save', async () => {
      mocks.readSkill.mockResolvedValueOnce({
        ok: true,
        data: sampleSkillDetail,
        hash: 'old-hash',
      })
      mocks.saveSkillDocument.mockResolvedValue({
        ok: false,
        error: 'kb_unavailable',
      })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ description: 'Updated' })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(503)
      const json = await response.json()
      expect(json).toEqual({ error: 'kb_unavailable' })
    })

    it('returns 500 when readSkill fails after successful save', async () => {
      mocks.readSkill
        .mockResolvedValueOnce({
          ok: true,
          data: sampleSkillDetail,
          hash: 'old-hash',
        })
        .mockResolvedValueOnce({
          ok: false,
          error: 'read_failed',
        })
      mocks.saveSkillDocument.mockResolvedValue({ ok: true, hash: 'new-hash' })

      const { PATCH } = await import('../route')
      const request = buildPatchRequest({ description: 'Updated' })
      const response = await PATCH(request, buildParams())

      expect(response.status).toBe(500)
      const json = await response.json()
      expect(json).toEqual({ error: 'read_failed' })
    })
  })

  describe('DELETE', () => {
    it('deletes a skill (admin only)', async () => {
      mocks.deleteSkill.mockResolvedValue({ ok: true, hash: 'del-hash' })

      const { DELETE } = await import('../route')
      const request = buildDeleteRequest()
      const response = await DELETE(request, buildParams())

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json).toEqual({ hash: 'del-hash' })

      expect(mocks.deleteSkill).toHaveBeenCalledWith('test-skill', undefined)

      expect(mocks.auditEvent).toHaveBeenCalledWith({
        actorUserId: 'admin-1',
        action: 'skill.deleted',
        metadata: { slug: 'alice', skillName: 'test-skill' },
      })
    })

    it('passes expectedHash when provided', async () => {
      mocks.deleteSkill.mockResolvedValue({ ok: true, hash: 'del-hash' })

      const { DELETE } = await import('../route')
      const request = buildDeleteRequest({ expectedHash: 'prev-hash' })
      const response = await DELETE(request, buildParams())

      expect(response.status).toBe(200)
      expect(mocks.deleteSkill).toHaveBeenCalledWith('test-skill', 'prev-hash')
    })

    it('rejects non-admin users with 403', async () => {
      mocks.getSession.mockResolvedValue(memberSession)

      const { DELETE } = await import('../route')
      const request = buildDeleteRequest()
      const response = await DELETE(request, buildParams())

      expect(response.status).toBe(403)
      const json = await response.json()
      expect(json).toEqual({ error: 'forbidden' })
      expect(mocks.deleteSkill).not.toHaveBeenCalled()
    })

    it('returns 404 for missing skill', async () => {
      mocks.deleteSkill.mockResolvedValue({
        ok: false,
        error: 'not_found',
      })

      const { DELETE } = await import('../route')
      const request = buildDeleteRequest()
      const response = await DELETE(request, buildParams('nonexistent'))

      expect(response.status).toBe(404)
      const json = await response.json()
      expect(json).toEqual({ error: 'not_found' })
    })

    it('returns 409 for conflict error', async () => {
      mocks.deleteSkill.mockResolvedValue({
        ok: false,
        error: 'conflict',
      })

      const { DELETE } = await import('../route')
      const request = buildDeleteRequest({ expectedHash: 'stale' })
      const response = await DELETE(request, buildParams())

      expect(response.status).toBe(409)
      const json = await response.json()
      expect(json).toEqual({ error: 'conflict' })
    })

    it('returns 503 when kb is unavailable', async () => {
      mocks.deleteSkill.mockResolvedValue({
        ok: false,
        error: 'kb_unavailable',
      })

      const { DELETE } = await import('../route')
      const request = buildDeleteRequest()
      const response = await DELETE(request, buildParams())

      expect(response.status).toBe(503)
      const json = await response.json()
      expect(json).toEqual({ error: 'kb_unavailable' })
    })

    it('handles missing request body gracefully', async () => {
      mocks.deleteSkill.mockResolvedValue({ ok: true, hash: 'del-hash' })

      const { DELETE } = await import('../route')
      const request = new NextRequest('http://localhost/api/u/alice/skills/test-skill', {
        method: 'DELETE',
        headers: { Origin: 'http://localhost' },
      })
      const response = await DELETE(request, buildParams())

      expect(response.status).toBe(200)
      expect(mocks.deleteSkill).toHaveBeenCalledWith('test-skill', undefined)
    })

    it('returns 401 when session is missing', async () => {
      mocks.getSession.mockResolvedValue(null)

      const { DELETE } = await import('../route')
      const request = buildDeleteRequest()
      const response = await DELETE(request, buildParams())

      expect(response.status).toBe(401)
    })
  })
})

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),

  createWorkspaceAgentClient: vi.fn(),
  workspaceAgentFetch: vi.fn(),

  normalizeAttachmentPath: vi.fn((p: string) => p),
  isWorkspaceAttachmentPath: vi.fn(() => true),
  sanitizeAttachmentFilename: vi.fn((n: string) => n.trim()),
  ensureUniqueAttachmentFilename: vi.fn((name: string) => name),
  inferAttachmentMimeType: vi.fn(() => 'application/octet-stream'),
  WORKSPACE_ATTACHMENTS_DIR: '/workspace/attachments',
  MAX_ATTACHMENT_UPLOAD_BYTES: 20 * 1024 * 1024,
  MAX_ATTACHMENT_UPLOAD_MEGABYTES: 20,
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/workspace-agent/client', () => ({ createWorkspaceAgentClient: mocks.createWorkspaceAgentClient }))
vi.mock('@/lib/workspace-agent-client', () => ({ workspaceAgentFetch: mocks.workspaceAgentFetch }))
vi.mock('@/lib/workspace-attachments', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/workspace-attachments')>()
  return {
    ...original,
    normalizeAttachmentPath: mocks.normalizeAttachmentPath,
    isWorkspaceAttachmentPath: mocks.isWorkspaceAttachmentPath,
    sanitizeAttachmentFilename: mocks.sanitizeAttachmentFilename,
    ensureUniqueAttachmentFilename: mocks.ensureUniqueAttachmentFilename,
    inferAttachmentMimeType: mocks.inferAttachmentMimeType,
    WORKSPACE_ATTACHMENTS_DIR: mocks.WORKSPACE_ATTACHMENTS_DIR,
    MAX_ATTACHMENT_UPLOAD_BYTES: mocks.MAX_ATTACHMENT_UPLOAD_BYTES,
    MAX_ATTACHMENT_UPLOAD_MEGABYTES: mocks.MAX_ATTACHMENT_UPLOAD_MEGABYTES,
  }
})

import { GET, POST, PATCH, DELETE } from '../route'

const USER_SESSION = {
  user: { id: 'u1', email: 'u@test.com', slug: 'alice', role: 'USER' },
  sessionId: 's1',
}

describe('/api/w/[slug]/attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(USER_SESSION)
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false })
    mocks.isDesktop.mockReturnValue(false)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.createWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent:3000',
      authHeader: 'Basic test',
    })
    mocks.workspaceAgentFetch.mockResolvedValue({
      ok: true,
      data: {
        entries: [
          { path: '/workspace/attachments/file1.txt', name: 'file1.txt', type: 'file', size: 100, modifiedAt: 1700000000000 },
        ],
      },
      status: 200,
    })
    // Reset mock implementations that may have been changed by individual tests
    mocks.isWorkspaceAttachmentPath.mockReturnValue(true)
    mocks.sanitizeAttachmentFilename.mockImplementation((n: string) => n.trim())
  })

  function makeRequest(method: string, url: string, init?: RequestInit): NextRequest {
    return new NextRequest(new URL(url, 'http://localhost'), { method, ...init })
  }

  function bodyParams(slug = 'alice') {
    return { params: Promise.resolve({ slug }) }
  }

  describe('GET', () => {
    it('lists attachments', async () => {
      const res = await GET(makeRequest('GET', 'http://localhost/api/w/alice/attachments'), bodyParams())
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.attachments).toHaveLength(1)
      expect(json.attachments[0].name).toBe('file1.txt')
    })

    it('returns empty list when attachments dir is 404', async () => {
      mocks.workspaceAgentFetch.mockResolvedValue({ ok: false, error: 'not_found', status: 404 })
      const res = await GET(makeRequest('GET', 'http://localhost/api/w/alice/attachments'), bodyParams())
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.attachments).toEqual([])
    })

    it('returns 502 when workspace agent fetch fails', async () => {
      mocks.workspaceAgentFetch.mockResolvedValue({ ok: false, error: 'agent_error', status: 500 })
      const res = await GET(makeRequest('GET', 'http://localhost/api/w/alice/attachments'), bodyParams())
      expect(res.status).toBe(502)
      const json = await res.json()
      expect(json.error).toBe('agent_error')
    })

    it('returns 503 when instance is unavailable', async () => {
      mocks.createWorkspaceAgentClient.mockResolvedValue(null)
      const res = await GET(makeRequest('GET', 'http://localhost/api/w/alice/attachments'), bodyParams())
      expect(res.status).toBe(503)
      const json = await res.json()
      expect(json.error).toBe('instance_unavailable')
    })

    it('returns 401 when not authenticated', async () => {
      mocks.getSession.mockResolvedValue(null)
      const res = await GET(makeRequest('GET', 'http://localhost/api/w/alice/attachments'), bodyParams())
      expect(res.status).toBe(401)
    })

    it('respects limit param', async () => {
      mocks.workspaceAgentFetch.mockResolvedValue({
        ok: true,
        data: {
          entries: [
            { path: '/workspace/attachments/a.txt', name: 'a.txt', type: 'file', size: 1, modifiedAt: 1700000000000 },
            { path: '/workspace/attachments/b.txt', name: 'b.txt', type: 'file', size: 1, modifiedAt: 1699999999999 },
          ],
        },
        status: 200,
      })
      const res = await GET(
        makeRequest('GET', 'http://localhost/api/w/alice/attachments?limit=1'),
        bodyParams(),
      )
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.attachments).toHaveLength(1)
    })
  })

  describe('POST', () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, path: '/workspace/attachments/file.txt', size: 100, modifiedAt: 1700000000000 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })

    it('uploads a file successfully', async () => {
      const res = await POST(
        makeRequest('POST', 'http://localhost/api/w/alice/attachments?filename=file.txt', {
          body: 'file-content',
          headers: { 'content-type': 'text/plain' },
        }),
        bodyParams(),
      )
      expect(res.status).toBe(201)
      const json = await res.json()
      expect(json.attachment.name).toBe('file.txt')
    })

    it('returns 400 for invalid filename', async () => {
      mocks.sanitizeAttachmentFilename.mockReturnValue('')
      const res = await POST(
        makeRequest('POST', 'http://localhost/api/w/alice/attachments?filename=   ', {
          body: 'x',
        }),
        bodyParams(),
      )
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_filename')
    })

    it('returns 400 when body is missing', async () => {
      const res = await POST(
        makeRequest('POST', 'http://localhost/api/w/alice/attachments?filename=file.txt'),
        bodyParams(),
      )
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('missing_file')
    })

    it('returns 413 when content-length exceeds limit', async () => {
      const res = await POST(
        makeRequest('POST', 'http://localhost/api/w/alice/attachments?filename=big.bin', {
          body: 'x',
          headers: {
            'content-length': String(30 * 1024 * 1024),
          },
        }),
        bodyParams(),
      )
      expect(res.status).toBe(413)
      const json = await res.json()
      expect(json.error).toBe('file_too_large')
    })

    it('returns 503 when instance unavailable', async () => {
      mocks.createWorkspaceAgentClient.mockResolvedValue(null)
      const res = await POST(
        makeRequest('POST', 'http://localhost/api/w/alice/attachments?filename=file.txt', {
          body: 'content',
        }),
        bodyParams(),
      )
      expect(res.status).toBe(503)
      const json = await res.json()
      expect(json.error).toBe('instance_unavailable')
    })
  })

  describe('PATCH', () => {
    it('renames an attachment successfully', async () => {
      mocks.workspaceAgentFetch
        .mockResolvedValueOnce({ ok: true, data: { path: '/workspace/attachments/new.txt', newPath: '/workspace/attachments/new.txt' }, status: 200 })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            entries: [
              { path: '/workspace/attachments/new.txt', name: 'new.txt', type: 'file', size: 100, modifiedAt: 1700000000000 },
            ],
          },
          status: 200,
        })
      const res = await PATCH(
        makeRequest('PATCH', 'http://localhost/api/w/alice/attachments', {
          body: JSON.stringify({ path: '/workspace/attachments/old.txt', name: 'new.txt' }),
          headers: { 'content-type': 'application/json' },
        }),
        bodyParams(),
      )
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.attachment.name).toBe('new.txt')
    })

    it('returns 400 for invalid path', async () => {
      mocks.isWorkspaceAttachmentPath.mockReturnValue(false)
      const res = await PATCH(
        makeRequest('PATCH', 'http://localhost/api/w/alice/attachments', {
          body: JSON.stringify({ path: '/etc/passwd', name: 'ok' }),
          headers: { 'content-type': 'application/json' },
        }),
        bodyParams(),
      )
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_path')
    })

    it('returns 400 for invalid name', async () => {
      mocks.sanitizeAttachmentFilename.mockReturnValue('')
      const res = await PATCH(
        makeRequest('PATCH', 'http://localhost/api/w/alice/attachments', {
          body: JSON.stringify({ path: '/workspace/attachments/f.txt', name: '   ' }),
          headers: { 'content-type': 'application/json' },
        }),
        bodyParams(),
      )
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_name')
    })

    it('returns 409 when rename conflicts', async () => {
      mocks.workspaceAgentFetch.mockResolvedValue({ ok: false, error: 'already_exists', status: 409 })
      const res = await PATCH(
        makeRequest('PATCH', 'http://localhost/api/w/alice/attachments', {
          body: JSON.stringify({ path: '/workspace/attachments/a.txt', name: 'b.txt' }),
          headers: { 'content-type': 'application/json' },
        }),
        bodyParams(),
      )
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toBe('already_exists')
    })

    it('returns 404 when renamed file not found in listing', async () => {
      mocks.workspaceAgentFetch
        .mockResolvedValueOnce({ ok: true, data: {}, status: 200 })
        .mockResolvedValueOnce({ ok: true, data: { entries: [] }, status: 200 })
      const res = await PATCH(
        makeRequest('PATCH', 'http://localhost/api/w/alice/attachments', {
          body: JSON.stringify({ path: '/workspace/attachments/old.txt', name: 'new.txt' }),
          headers: { 'content-type': 'application/json' },
        }),
        bodyParams(),
      )
      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('not_found')
    })
  })

  describe('DELETE', () => {
    it('deletes an attachment successfully', async () => {
      mocks.workspaceAgentFetch.mockResolvedValue({ ok: true, data: {}, status: 200 })
      const res = await DELETE(
        makeRequest('DELETE', 'http://localhost/api/w/alice/attachments', {
          body: JSON.stringify({ path: '/workspace/attachments/file.txt' }),
          headers: { 'content-type': 'application/json' },
        }),
        bodyParams(),
      )
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
    })

    it('returns 400 for invalid path', async () => {
      mocks.isWorkspaceAttachmentPath.mockReturnValue(false)
      const res = await DELETE(
        makeRequest('DELETE', 'http://localhost/api/w/alice/attachments', {
          body: JSON.stringify({ path: '/etc/passwd' }),
          headers: { 'content-type': 'application/json' },
        }),
        bodyParams(),
      )
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_path')
    })

    it('returns 404 when attachment not found', async () => {
      mocks.workspaceAgentFetch.mockResolvedValue({ ok: false, error: 'not_found', status: 404 })
      const res = await DELETE(
        makeRequest('DELETE', 'http://localhost/api/w/alice/attachments', {
          body: JSON.stringify({ path: '/workspace/attachments/missing.txt' }),
          headers: { 'content-type': 'application/json' },
        }),
        bodyParams(),
      )
      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toBe('not_found')
    })

    it('returns 401 when not authenticated', async () => {
      mocks.getSession.mockResolvedValue(null)
      const res = await DELETE(
        makeRequest('DELETE', 'http://localhost/api/w/alice/attachments', {
          body: JSON.stringify({ path: '/workspace/attachments/file.txt' }),
          headers: { 'content-type': 'application/json' },
        }),
        bodyParams(),
      )
      expect(res.status).toBe(401)
    })
  })
})

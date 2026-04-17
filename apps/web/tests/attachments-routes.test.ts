import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_ATTACHMENT_UPLOAD_MEGABYTES,
} from '@/lib/workspace-attachments'

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

const mockCreateWorkspaceAgentClient = vi.fn()
vi.mock('@/lib/workspace-agent/client', () => ({
  createWorkspaceAgentClient: (...args: unknown[]) =>
    mockCreateWorkspaceAgentClient(...args),
}))

type Role = 'USER' | 'ADMIN'

function session(slug: string, role: Role = 'USER') {
  return {
    user: { id: 'user-1', email: 'alice@example.com', slug, role },
    sessionId: 'session-1',
  }
}

async function callGetAttachments(slug = 'alice') {
  const { GET } = await import('@/app/api/w/[slug]/attachments/route')
  const req = new Request(`http://localhost/api/w/${slug}/attachments`)
  const res = await GET(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

async function callPostAttachments(options: {
  slug?: string
  files: File[]
  includeOrigin?: boolean
  formDataOverride?: FormData
}) {
  const { POST } = await import('@/app/api/w/[slug]/attachments/route')
  const slug = options.slug ?? 'alice'

  const formData = new FormData()
  options.files.forEach((file) => formData.append('files', file))

  const headers = new Headers({ host: 'localhost' })
  if (options.includeOrigin !== false) {
    headers.set('origin', 'http://localhost')
  }

  const req = new Request(`http://localhost/api/w/${slug}/attachments`, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (options.formDataOverride) {
    Object.defineProperty(req, 'formData', {
      value: async () => options.formDataOverride,
    })
  }

  const res = await POST(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

async function callPatchAttachment(options: {
  slug?: string
  path: string
  name: string
  includeOrigin?: boolean
}) {
  const { PATCH } = await import('@/app/api/w/[slug]/attachments/route')
  const slug = options.slug ?? 'alice'

  const headers = new Headers({
    host: 'localhost',
    'content-type': 'application/json',
  })
  if (options.includeOrigin !== false) {
    headers.set('origin', 'http://localhost')
  }

  const req = new Request(`http://localhost/api/w/${slug}/attachments`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ path: options.path, name: options.name }),
  })
  const res = await PATCH(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

async function callDeleteAttachment(options: {
  slug?: string
  path: string
  includeOrigin?: boolean
}) {
  const { DELETE } = await import('@/app/api/w/[slug]/attachments/route')
  const slug = options.slug ?? 'alice'

  const headers = new Headers({
    host: 'localhost',
    'content-type': 'application/json',
  })
  if (options.includeOrigin !== false) {
    headers.set('origin', 'http://localhost')
  }

  const req = new Request(`http://localhost/api/w/${slug}/attachments`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ path: options.path }),
  })
  const res = await DELETE(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

describe('workspace attachments route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: 'http://agent',
      authHeader: 'Basic token',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GET returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null)

    const { status, body } = await callGetAttachments('alice')
    expect(status).toBe(401)
    expect(body.error).toBe('unauthorized')
  })

  it('GET returns sorted attachment list from workspace agent', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          entries: [
            {
              path: '.arche/attachments/first.txt',
              name: 'first.txt',
              type: 'file',
              size: 12,
              modifiedAt: 100,
            },
            {
              path: '.arche/attachments/folder',
              name: 'folder',
              type: 'directory',
              size: 0,
              modifiedAt: 300,
            },
            {
              path: '.arche/attachments/second.pdf',
              name: 'second.pdf',
              type: 'file',
              size: 42,
              modifiedAt: 200,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { status, body } = await callGetAttachments('alice')
    expect(status).toBe(200)
    expect(body.attachments).toHaveLength(2)
    expect(body.attachments[0].path).toBe('.arche/attachments/second.pdf')
    expect(body.attachments[1].path).toBe('.arche/attachments/first.txt')
  })

  it('GET returns 403 when session slug does not match route slug', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('bob'))

    const { status, body } = await callGetAttachments('alice')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('POST enforces same-origin validation', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))

    const { status, body } = await callPostAttachments({
      files: [new File(['x'], 'a.txt', { type: 'text/plain' })],
      includeOrigin: false,
    })

    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('POST uploads files using base64 encoding and resolves name conflicts', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            entries: [
              {
                path: '.arche/attachments/report.pdf',
                name: 'report.pdf',
                type: 'file',
                size: 10,
                modifiedAt: 1,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, hash: 'h1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, hash: 'h2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { status, body } = await callPostAttachments({
      files: [
        new File(['pdf-data'], 'report.pdf', { type: 'application/pdf' }),
        new File(['img-data'], 'diagram.png', { type: 'image/png' }),
      ],
    })

    expect(status).toBe(201)
    expect(body.uploaded).toHaveLength(2)
    expect(body.failed).toEqual([])
    expect(body.uploaded[0].name).toBe('report (1).pdf')
    expect(body.uploaded[1].name).toBe('diagram.png')

    const firstWriteBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(firstWriteBody.path).toBe('.arche/attachments/report (1).pdf')
    expect(firstWriteBody.encoding).toBe('base64')
    expect(typeof firstWriteBody.content).toBe('string')
    expect(firstWriteBody.content.length).toBeGreaterThan(0)
  })

  it('POST rejects files larger than the upload limit', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const oversizedFile = new File(['x'], 'huge.bin', { type: 'application/octet-stream' })
    Object.defineProperty(oversizedFile, 'size', {
      value: MAX_ATTACHMENT_UPLOAD_BYTES + 1,
    })

    const formData = new FormData()
    formData.append('files', oversizedFile)

    const { status, body } = await callPostAttachments({
      files: [oversizedFile],
      formDataOverride: formData,
    })

    expect(status).toBe(413)
    expect(body).toEqual({
      error: 'file_too_large',
      maxBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
      maxMegabytes: MAX_ATTACHMENT_UPLOAD_MEGABYTES,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POST returns per-file failures without losing successes', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            entries: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, hash: 'h1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: 'write_failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { status, body } = await callPostAttachments({
      files: [
        new File(['ok'], 'ok.txt', { type: 'text/plain' }),
        new File(['bad'], 'bad.txt', { type: 'text/plain' }),
      ],
    })

    expect(status).toBe(207)
    expect(body.uploaded).toHaveLength(1)
    expect(body.failed).toHaveLength(1)
    expect(body.failed[0].name).toBe('bad.txt')
    expect(body.failed[0].error).toBe('write_failed')
  })

  it('PATCH renames a workspace attachment', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, newPath: '.arche/attachments/renamed.pdf' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            entries: [
              {
                path: '.arche/attachments/renamed.pdf',
                name: 'renamed.pdf',
                type: 'file',
                size: 33,
                modifiedAt: 55,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { status, body } = await callPatchAttachment({
      path: '.arche/attachments/report.pdf',
      name: 'renamed.pdf',
    })

    expect(status).toBe(200)
    expect(body.attachment.path).toBe('.arche/attachments/renamed.pdf')

    const renameBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(renameBody.path).toBe('.arche/attachments/report.pdf')
    expect(renameBody.newPath).toBe('.arche/attachments/renamed.pdf')
  })

  it('DELETE removes a workspace attachment', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { status, body } = await callDeleteAttachment({
      path: '.arche/attachments/report.pdf',
    })

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    const deleteBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(deleteBody.path).toBe('.arche/attachments/report.pdf')
  })
})

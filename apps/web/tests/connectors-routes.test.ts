import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
const mockAuditEvent = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
  auditEvent: (...args: unknown[]) => mockAuditEvent(...args),
}))

const mockUserFindUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  },
}))

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { user: { id: 'user-1', email: 'a@b.com', slug, role }, sessionId: 's1' }
}

async function callPostConnectors(slug = 'alice', includeOrigin = false) {
  const { POST } = await import('@/app/api/u/[slug]/connectors/route')
  const headers: Record<string, string> = {
    host: 'localhost',
    'content-type': 'application/json',
  }
  if (includeOrigin) {
    headers.origin = 'http://localhost'
  }

  const req = new Request(`http://localhost/api/u/${slug}/connectors`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
  const res = await POST(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

async function callPatchConnector(slug = 'alice', id = 'conn-1') {
  const { PATCH } = await import('@/app/api/u/[slug]/connectors/[id]/route')
  const req = new Request(`http://localhost/api/u/${slug}/connectors/${id}`, {
    method: 'PATCH',
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'Updated' }),
  })
  const res = await PATCH(req as never, { params: Promise.resolve({ slug, id }) })
  return { status: res.status, body: await res.json() }
}

async function callDeleteConnector(slug = 'alice', id = 'conn-1') {
  const { DELETE } = await import('@/app/api/u/[slug]/connectors/[id]/route')
  const req = new Request(`http://localhost/api/u/${slug}/connectors/${id}`, {
    method: 'DELETE',
    headers: {
      host: 'localhost',
    },
  })
  const res = await DELETE(req as never, { params: Promise.resolve({ slug, id }) })
  return { status: res.status, body: await res.json() }
}

async function callPostConnectorTest(slug = 'alice', id = 'conn-1') {
  const { POST } = await import('@/app/api/u/[slug]/connectors/[id]/test/route')
  const req = new Request(`http://localhost/api/u/${slug}/connectors/${id}/test`, {
    method: 'POST',
    headers: {
      host: 'localhost',
    },
  })
  const res = await POST(req as never, { params: Promise.resolve({ slug, id }) })
  return { status: res.status, body: await res.json() }
}

async function callPostConnectorOAuthStart(slug = 'alice', id = 'conn-1') {
  const { POST } = await import('@/app/api/u/[slug]/connectors/[id]/oauth/start/route')

  const url = `http://localhost/api/u/${slug}/connectors/${id}/oauth/start`
  const req = {
    headers: new Headers({ host: 'localhost' }),
    nextUrl: new URL(url),
  }

  const res = await POST(req as never, { params: Promise.resolve({ slug, id }) })
  return { status: res.status, body: await res.json() }
}

async function callPatchZendeskSettings(slug = 'alice', id = 'conn-1') {
  const { PATCH } = await import('@/app/api/u/[slug]/connectors/[id]/zendesk-settings/route')
  const req = new Request(`http://localhost/api/u/${slug}/connectors/${id}/zendesk-settings`, {
    method: 'PATCH',
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ permissions: {} }),
  })
  const res = await PATCH(req as never, { params: Promise.resolve({ slug, id }) })
  return { status: res.status, body: await res.json() }
}

async function callPatchMetaAdsSettings(slug = 'alice', id = 'conn-1') {
  const { PATCH } = await import('@/app/api/u/[slug]/connectors/[id]/meta-ads-settings/route')
  const req = new Request(`http://localhost/api/u/${slug}/connectors/${id}/meta-ads-settings`, {
    method: 'PATCH',
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ appId: 'meta-app-id' }),
  })
  const res = await PATCH(req as never, { params: Promise.resolve({ slug, id }) })
  return { status: res.status, body: await res.json() }
}

describe('CSRF guard for connectors routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice', 'USER'))
    mockUserFindUnique.mockResolvedValue(null)
  })

  it('POST /api/u/[slug]/connectors returns 403 when Origin is missing', async () => {
    const { status, body } = await callPostConnectors('alice')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('POST /api/u/[slug]/connectors does not fail CSRF when Origin matches', async () => {
    const { status, body } = await callPostConnectors('alice', true)
    expect(status).toBe(404)
    expect(body.error).toBe('user_not_found')
  })

  it('PATCH /api/u/[slug]/connectors/[id] returns 403 when Origin is missing', async () => {
    const { status, body } = await callPatchConnector('alice', 'conn-1')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('DELETE /api/u/[slug]/connectors/[id] returns 403 when Origin is missing', async () => {
    const { status, body } = await callDeleteConnector('alice', 'conn-1')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('POST /api/u/[slug]/connectors/[id]/test returns 403 when Origin is missing', async () => {
    const { status, body } = await callPostConnectorTest('alice', 'conn-1')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('POST /api/u/[slug]/connectors/[id]/oauth/start returns 403 when Origin is missing', async () => {
    const { status, body } = await callPostConnectorOAuthStart('alice', 'conn-1')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('PATCH /api/u/[slug]/connectors/[id]/zendesk-settings returns 403 when Origin is missing', async () => {
    const { status, body } = await callPatchZendeskSettings('alice', 'conn-1')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('PATCH /api/u/[slug]/connectors/[id]/meta-ads-settings returns 403 when Origin is missing', async () => {
    const { status, body } = await callPatchMetaAdsSettings('alice', 'conn-1')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })
})

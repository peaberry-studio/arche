import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
  auditEvent: vi.fn(),
}))

const mockReadCommonWorkspaceConfig = vi.fn()
const mockWriteCommonWorkspaceConfig = vi.fn()
vi.mock('@/lib/common-workspace-config-store', () => ({
  readCommonWorkspaceConfig: (...args: unknown[]) => mockReadCommonWorkspaceConfig(...args),
  writeCommonWorkspaceConfig: (...args: unknown[]) => mockWriteCommonWorkspaceConfig(...args),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    connector: {
      findMany: vi.fn(),
    },
  },
}))

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { user: { id: 'user-1', email: 'a@b.com', slug, role }, sessionId: 's1' }
}

async function callPostAgents(slug = 'admin') {
  const { POST } = await import('@/app/api/u/[slug]/agents/route')
  const req = new Request(`http://localhost/api/u/${slug}/agents`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
    },
    body: 'not-json',
  })
  const res = await POST(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

async function callPatchAgent(slug = 'admin', name = 'agent-1') {
  const { PATCH } = await import('@/app/api/u/[slug]/agents/[name]/route')
  const req = new Request(`http://localhost/api/u/${slug}/agents/${name}`, {
    method: 'PATCH',
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
    },
    body: 'not-json',
  })
  const res = await PATCH(req as never, { params: Promise.resolve({ slug, name }) })
  return { status: res.status, body: await res.json() }
}

async function callDeleteAgent(slug = 'admin', name = 'agent-1') {
  const { DELETE } = await import('@/app/api/u/[slug]/agents/[name]/route')
  const req = new Request(`http://localhost/api/u/${slug}/agents/${name}`, {
    method: 'DELETE',
    headers: {
      host: 'localhost',
    },
  })
  const res = await DELETE(req as never, { params: Promise.resolve({ slug, name }) })
  return { status: res.status, body: await res.json() }
}

describe('CSRF guard for agents routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('admin', 'ADMIN'))
    mockReadCommonWorkspaceConfig.mockResolvedValue({ ok: false, error: 'not_found' })
    mockWriteCommonWorkspaceConfig.mockResolvedValue({ ok: false, error: 'write_failed' })
  })

  it('POST /api/u/[slug]/agents returns 403 when Origin is missing', async () => {
    const { status, body } = await callPostAgents('admin')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('PATCH /api/u/[slug]/agents/[name] returns 403 when Origin is missing', async () => {
    const { status, body } = await callPatchAgent('admin', 'agent-1')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('DELETE /api/u/[slug]/agents/[name] returns 403 when Origin is missing', async () => {
    const { status, body } = await callDeleteAgent('admin', 'agent-1')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })
})

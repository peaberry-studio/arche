import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

const mockStopInstance = vi.fn()
const mockStartInstance = vi.fn()
vi.mock('@/lib/spawner/core', () => ({
  stopInstance: (...args: unknown[]) => mockStopInstance(...args),
  startInstance: (...args: unknown[]) => mockStartInstance(...args),
}))

const mockFindUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    instance: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}))

const mockCreateWorkspaceAgentClient = vi.fn()
vi.mock('@/lib/workspace-agent/client', () => ({
  createWorkspaceAgentClient: (...args: unknown[]) => mockCreateWorkspaceAgentClient(...args),
}))

function session(slug: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { user: { id: 'user-1', email: 'a@b.com', slug, role }, sessionId: 's1' }
}

async function callPostRestart(slug = 'alice') {
  const { POST } = await import('@/app/api/instances/[slug]/restart/route')
  const req = new Request(`http://localhost/api/instances/${slug}/restart`, {
    method: 'POST',
    headers: {
      host: 'localhost',
    },
  })
  const res = await POST(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

async function callPostSyncKb(slug = 'alice') {
  const { POST } = await import('@/app/api/instances/[slug]/sync-kb/route')
  const req = new Request(`http://localhost/api/instances/${slug}/sync-kb`, {
    method: 'POST',
    headers: {
      host: 'localhost',
    },
  })
  const res = await POST(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

describe('CSRF guard for instances routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockGetAuthenticatedUser.mockResolvedValue(session('alice', 'USER'))
    mockStopInstance.mockResolvedValue({ ok: true })
    mockStartInstance.mockResolvedValue({ ok: true, status: 'running' })
    mockFindUnique.mockResolvedValue(null)
    mockCreateWorkspaceAgentClient.mockResolvedValue(null)
  })

  it('POST /api/instances/[slug]/restart returns 403 when Origin is missing', async () => {
    const { status, body } = await callPostRestart('alice')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })

  it('POST /api/instances/[slug]/sync-kb returns 403 when Origin is missing', async () => {
    const { status, body } = await callPostSyncKb('alice')
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
  })
})

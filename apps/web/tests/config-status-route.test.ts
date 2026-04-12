import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAuthenticatedUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

const mockGetRuntimeConfigHashForSlug = vi.fn()
vi.mock('@/lib/spawner/runtime-config-hash', () => ({
  getRuntimeConfigHashForSlug: (...args: unknown[]) => mockGetRuntimeConfigHashForSlug(...args),
}))

const mockFindAppliedConfigShaBySlug = vi.fn()
const mockFindIdBySlug = vi.fn()
const mockHasPendingRestartByUserId = vi.fn()
vi.mock('@/lib/services', () => ({
  instanceService: {
    findAppliedConfigShaBySlug: (...args: unknown[]) => mockFindAppliedConfigShaBySlug(...args),
  },
  userService: {
    findIdBySlug: (...args: unknown[]) => mockFindIdBySlug(...args),
  },
  providerService: {
    hasPendingRestartByUserId: (...args: unknown[]) => mockHasPendingRestartByUserId(...args),
  },
}))

function session(slug: string, role = 'USER') {
  return { user: { id: 'user-1', email: 'a@b.com', slug, role }, sessionId: 's1' }
}

async function callConfigStatus(slug = 'alice') {
  const { GET } = await import('@/app/api/instances/[slug]/config-status/route')
  const req = new Request(`http://localhost/api/instances/${slug}/config-status`)
  const res = await GET(req as never, { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}

describe('GET /api/instances/[slug]/config-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetAuthenticatedUser.mockResolvedValue(session('alice'))
    mockGetRuntimeConfigHashForSlug.mockResolvedValue({ ok: true, hash: 'runtime-hash' })
    mockFindAppliedConfigShaBySlug.mockResolvedValue({ appliedConfigSha: 'runtime-hash' })
    mockFindIdBySlug.mockResolvedValue({ id: 'user-1' })
    mockHasPendingRestartByUserId.mockResolvedValue(false)
  })

  it('reports config drift when the applied hash differs', async () => {
    mockFindAppliedConfigShaBySlug.mockResolvedValue({ appliedConfigSha: 'old-hash' })

    const { status, body } = await callConfigStatus('alice')

    expect(status).toBe(200)
    expect(body).toEqual({ pending: true, reason: 'config' })
  })

  it('does not report pending changes before a workspace has applied any config', async () => {
    mockFindAppliedConfigShaBySlug.mockResolvedValue(null)

    const { status, body } = await callConfigStatus('alice')

    expect(status).toBe(200)
    expect(body).toEqual({ pending: false, reason: null })
  })

  it('reports provider sync restart requirements when runtime hashes already match', async () => {
    mockHasPendingRestartByUserId.mockResolvedValue(true)

    const { status, body } = await callConfigStatus('alice')

    expect(status).toBe(200)
    expect(body).toEqual({ pending: true, reason: 'provider_sync' })
  })
})

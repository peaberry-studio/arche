import { NextRequest } from 'next/server'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from '@/app/api/instances/[slug]/migration-status/route'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getInstanceMigrationStatusAction: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: () => ({ csrf: false }) }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: () => false }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/actions/spawner', () => ({ getInstanceMigrationStatusAction: mocks.getInstanceMigrationStatusAction }))

const SESSION = {
  user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
  sessionId: 's1',
}

function request(slug = 'alice') {
  return GET(
    new NextRequest(`http://localhost/api/instances/${slug}/migration-status`),
    { params: Promise.resolve({ slug }) },
  )
}

describe('GET /api/instances/[slug]/migration-status', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.getInstanceMigrationStatusAction.mockResolvedValue(false)
  })

  it('requires authentication before reading progress', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect((await request()).status).toBe(401)
    expect(mocks.getInstanceMigrationStatusAction).not.toHaveBeenCalled()
  })

  it('rejects another workspace owner', async () => {
    expect((await request('bob')).status).toBe(403)
    expect(mocks.getInstanceMigrationStatusAction).not.toHaveBeenCalled()
  })

  it.each([true, false])('returns uncached progress (%s)', async (migratingHistory) => {
    mocks.getInstanceMigrationStatusAction.mockResolvedValue(migratingHistory)
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ migratingHistory })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.getInstanceMigrationStatusAction).toHaveBeenCalledWith('alice')
  })

  it('allows admins to inspect workspace progress', async () => {
    mocks.getSession.mockResolvedValue({ ...SESSION, user: { ...SESSION.user, role: 'ADMIN' } })
    expect((await request('bob')).status).toBe(200)
    expect(mocks.getInstanceMigrationStatusAction).toHaveBeenCalledWith('bob')
  })

  it('returns a stable error when progress is unavailable', async () => {
    mocks.getInstanceMigrationStatusAction.mockResolvedValue(null)
    const response = await request()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'status_check_failed' })
  })
})

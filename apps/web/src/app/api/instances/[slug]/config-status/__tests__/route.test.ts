import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  getRuntimeConfigHashForSlug: vi.fn(),
  instanceService: { findAppliedConfigShaBySlug: vi.fn() },
  providerService: { hasPendingRestartByUserId: vi.fn() },
  userService: { findIdBySlug: vi.fn() },
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/spawner/runtime-config-hash', () => ({
  getRuntimeConfigHashForSlug: mocks.getRuntimeConfigHashForSlug,
}))
vi.mock('@/lib/services', () => ({
  instanceService: mocks.instanceService,
  providerService: mocks.providerService,
  userService: mocks.userService,
}))

import { GET } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
  sessionId: 's1',
}

function makeRequest() {
  return new NextRequest('http://localhost/api/instances/alice/config-status', { method: 'GET' })
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

describe('GET /api/instances/[slug]/config-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.getRuntimeConfigHashForSlug.mockResolvedValue({ ok: true, hash: 'abc123' })
    mocks.instanceService.findAppliedConfigShaBySlug.mockResolvedValue({ appliedConfigSha: 'abc123' })
    mocks.userService.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.providerService.hasPendingRestartByUserId.mockResolvedValue(false)
  })

  it('returns not pending when hashes match', async () => {
    const res = await GET(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body).toEqual({ pending: false, reason: null })
  })

  it('returns config pending when hashes differ', async () => {
    mocks.instanceService.findAppliedConfigShaBySlug.mockResolvedValue({ appliedConfigSha: 'old-hash' })

    const res = await GET(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body).toEqual({ pending: true, reason: 'config' })
  })

  it('returns provider_sync pending when provider has pending restart', async () => {
    mocks.providerService.hasPendingRestartByUserId.mockResolvedValue(true)

    const res = await GET(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body).toEqual({ pending: true, reason: 'provider_sync' })
  })

  it('config takes precedence over provider_sync', async () => {
    mocks.instanceService.findAppliedConfigShaBySlug.mockResolvedValue({ appliedConfigSha: 'old' })
    mocks.providerService.hasPendingRestartByUserId.mockResolvedValue(true)

    const res = await GET(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.reason).toBe('config')
  })

  it('returns 404 when runtime config not found', async () => {
    mocks.getRuntimeConfigHashForSlug.mockResolvedValue({ ok: false, error: 'not_found' })
    const res = await GET(makeRequest(), params('alice'))
    expect(res.status).toBe(404)
  })

  it('returns 503 when kb unavailable', async () => {
    mocks.getRuntimeConfigHashForSlug.mockResolvedValue({ ok: false, error: 'kb_unavailable' })
    const res = await GET(makeRequest(), params('alice'))
    expect(res.status).toBe(503)
  })

  it('returns 500 for read_failed', async () => {
    mocks.getRuntimeConfigHashForSlug.mockResolvedValue({ ok: false, error: 'read_failed' })
    const res = await GET(makeRequest(), params('alice'))
    expect(res.status).toBe(500)
  })

  it('returns not pending when instance has no applied config', async () => {
    mocks.instanceService.findAppliedConfigShaBySlug.mockResolvedValue({ appliedConfigSha: null })

    const res = await GET(makeRequest(), params('alice'))
    const body = await res.json()
    expect(body.pending).toBe(false)
  })
})

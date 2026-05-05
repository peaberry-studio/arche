import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  validateDesktopToken: vi.fn(() => true),
  getKickstartStatus: vi.fn(),
  stopWorkspace: vi.fn(),
  startWorkspace: vi.fn(),
  findIdBySlug: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/kickstart/status', () => ({
  getKickstartStatus: (...args: unknown[]) => mocks.getKickstartStatus(...args),
}))
vi.mock('@/lib/runtime/workspace-host', () => ({
  stopWorkspace: (...args: unknown[]) => mocks.stopWorkspace(...args),
  startWorkspace: (...args: unknown[]) => mocks.startWorkspace(...args),
}))
vi.mock('@/lib/services', () => ({
  userService: {
    findIdBySlug: (...args: unknown[]) => mocks.findIdBySlug(...args),
  },
}))

import { POST } from '../route'

const SESSION = {
  user: { id: 'u1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
  sessionId: 's1',
}

function makeRequest() {
  return new NextRequest('http://localhost/api/instances/alice/restart', { method: 'POST' })
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

describe('POST /api/instances/[slug]/restart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.findIdBySlug.mockResolvedValue({ id: 'u1' })
    mocks.getKickstartStatus.mockResolvedValue('ready')
    mocks.stopWorkspace.mockResolvedValue({ ok: true, status: 'stopped' })
    mocks.startWorkspace.mockResolvedValue({ ok: true, status: 'running' })
  })

  it('restarts workspace successfully', async () => {
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, status: 'running' })
    expect(mocks.stopWorkspace).toHaveBeenCalledWith('alice', 'u1')
    expect(mocks.startWorkspace).toHaveBeenCalledWith('alice', 'u1')
  })

  it('returns 404 when user not found', async () => {
    mocks.findIdBySlug.mockResolvedValue(null)
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'user_not_found' })
  })

  it('returns 409 when kickstart is not ready', async () => {
    mocks.getKickstartStatus.mockResolvedValue('needs_setup')
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'setup_required' })
  })

  it('returns 500 when stop workspace fails', async () => {
    mocks.stopWorkspace.mockResolvedValue({ ok: false, error: 'stop_failed' })
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'stop_failed' })
  })

  it('continues restart when workspace is not running', async () => {
    mocks.stopWorkspace.mockResolvedValue({ ok: false, error: 'not_running' })
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'running' })
  })

  it('returns 409 when start workspace reports already_running', async () => {
    mocks.startWorkspace.mockResolvedValue({ ok: false, error: 'already_running' })
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_running' })
  })

  it('returns 500 when start workspace fails for other reasons', async () => {
    mocks.startWorkspace.mockResolvedValue({ ok: false, error: 'start_failed' })
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'start_failed' })
  })

  it('returns 401 when not authenticated', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await POST(makeRequest(), params('alice'))
    expect(res.status).toBe(401)
  })
})

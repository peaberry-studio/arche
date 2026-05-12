import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ autopilot: true, csrf: false })),
  isDesktop: vi.fn(() => false),
  getSession: vi.fn(),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
  requireCapability: vi.fn(() => null),
  validateDesktopToken: vi.fn(() => true),
  auditEvent: vi.fn(),
  triggerAutopilotTaskNow: vi.fn(),
  slackService: {},
  userService: { findIdBySlug: vi.fn() },
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/require-capability', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/autopilot/runner', () => ({ triggerAutopilotTaskNow: mocks.triggerAutopilotTaskNow }))
vi.mock('@/lib/services', () => ({ slackService: mocks.slackService, userService: mocks.userService }))

import { POST } from '../route'

const SESSION = {
  user: { id: 'u-alice', email: 'alice@test.com', slug: 'alice', role: 'USER' as const },
  sessionId: 's1',
}

function makeRequest() {
  return new NextRequest('http://localhost/api/u/alice/autopilot/task-1/run', {
    method: 'POST',
    headers: { origin: 'http://localhost' },
  })
}

function params(slug: string, id: string) {
  return { params: Promise.resolve({ slug, id }) }
}

describe('POST /api/u/[slug]/autopilot/[id]/run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(SESSION)
    mocks.getRuntimeCapabilities.mockReturnValue({ autopilot: true, csrf: false })
    mocks.requireCapability.mockReturnValue(null)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
  })

  it('triggers task and returns 202', async () => {
    mocks.triggerAutopilotTaskNow.mockResolvedValue({ ok: true })

    const res = await POST(makeRequest(), params('alice', 'task-1'))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mocks.auditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'autopilot.task_manual_run_requested' }),
    )
  })

  it('returns 404 when task not found', async () => {
    mocks.triggerAutopilotTaskNow.mockResolvedValue({ ok: false, error: 'not_found' })

    const res = await POST(makeRequest(), params('alice', 'task-1'))
    expect(res.status).toBe(404)
  })

  it('returns 409 when task is busy', async () => {
    mocks.triggerAutopilotTaskNow.mockResolvedValue({ ok: false, error: 'task_busy' })

    const res = await POST(makeRequest(), params('alice', 'task-1'))
    expect(res.status).toBe(409)
  })

  it('returns 404 when slug does not resolve to a user', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'u-admin', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
      sessionId: 's1',
    })
    mocks.userService.findIdBySlug.mockResolvedValue(null)

    const res = await POST(makeRequest(), params('unknown', 'task-1'))
    expect(res.status).toBe(404)
  })

  it('returns 401 when not authenticated', async () => {
    mocks.getSession.mockResolvedValue(null)

    const res = await POST(makeRequest(), params('alice', 'task-1'))
    expect(res.status).toBe(401)
  })
})

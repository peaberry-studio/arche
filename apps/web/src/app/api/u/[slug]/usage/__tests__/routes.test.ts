import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  getSession: vi.fn(),
  isDesktop: vi.fn(() => false),
  providerUsageService: {
    getProviderUsageSummary: vi.fn(),
    listProviderUsageProviders: vi.fn(),
    listProviderUsageUsers: vi.fn(),
  },
  usageDashboardService: {
    listUsageAuditEvents: vi.fn(),
    listUsageSessions: vi.fn(),
  },
  validateDesktopToken: vi.fn(() => true),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/services', () => ({
  providerUsageService: mocks.providerUsageService,
  usageDashboardService: mocks.usageDashboardService,
}))

import { GET as GET_AUDIT } from '../audit/route'
import { GET as GET_PROVIDERS } from '../providers/route'
import { GET as GET_SESSIONS } from '../sessions/route'
import { GET as GET_SUMMARY } from '../summary/route'
import { GET as GET_USERS } from '../users/route'

const ADMIN_SESSION = {
  sessionId: 'session-1',
  user: { email: 'admin@example.com', id: 'admin-1', role: 'ADMIN', slug: 'admin' },
}

const USER_SESSION = {
  sessionId: 'session-2',
  user: { email: 'user@example.com', id: 'user-1', role: 'USER', slug: 'admin' },
}

type UsageRouteHandler = (
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) => Promise<Response>

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost/api/u/admin/usage/${path}`, { method: 'GET' })
}

function params() {
  return { params: Promise.resolve({ slug: 'admin' }) }
}

async function readJson(response: Response): Promise<unknown> {
  return response.json()
}

describe('usage API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(ADMIN_SESSION)
    mocks.providerUsageService.getProviderUsageSummary.mockResolvedValue({ requests: 3 })
    mocks.providerUsageService.listProviderUsageProviders.mockResolvedValue([{ providerId: 'openai' }])
    mocks.providerUsageService.listProviderUsageUsers.mockResolvedValue([{ userId: 'user-1' }])
    mocks.usageDashboardService.listUsageAuditEvents.mockResolvedValue([{ id: 'audit-1' }])
    mocks.usageDashboardService.listUsageSessions.mockResolvedValue([{ sessionId: 'session-1' }])
  })

  it('rejects non-admin users for every usage route', async () => {
    mocks.getSession.mockResolvedValue(USER_SESSION)
    const routes: UsageRouteHandler[] = [GET_AUDIT, GET_PROVIDERS, GET_SESSIONS, GET_SUMMARY, GET_USERS]

    for (const route of routes) {
      const response = await route(request('summary'), params())
      await expect(readJson(response)).resolves.toEqual({ error: 'forbidden' })
      expect(response.status).toBe(403)
    }
  })

  it('returns provider usage data with parsed provider filters', async () => {
    const query = 'from=2026-01-01T00%3A00%3A00.000Z&to=not-a-date&userId=user-1&providerId=openai&modelId=gpt-4o'

    const summary = await GET_SUMMARY(request(`summary?${query}`), params())
    const providers = await GET_PROVIDERS(request(`providers?${query}`), params())
    const users = await GET_USERS(request(`users?${query}`), params())

    await expect(readJson(summary)).resolves.toEqual({ summary: { requests: 3 } })
    await expect(readJson(providers)).resolves.toEqual({ providers: [{ providerId: 'openai' }] })
    await expect(readJson(users)).resolves.toEqual({ users: [{ userId: 'user-1' }] })
    expect(mocks.providerUsageService.getProviderUsageSummary).toHaveBeenCalledWith({
      from: new Date('2026-01-01T00:00:00.000Z'),
      modelId: 'gpt-4o',
      providerId: 'openai',
      to: undefined,
      userId: 'user-1',
    })
    expect(mocks.providerUsageService.listProviderUsageProviders).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'openai' }))
    expect(mocks.providerUsageService.listProviderUsageUsers).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'gpt-4o' }))
  })

  it('returns session and audit data with parsed dashboard filters', async () => {
    const sessionQuery = 'from=bad-date&to=2026-02-01T00%3A00%3A00.000Z&userId=%20%20'
    const auditQuery = `${sessionQuery}&providerId=anthropic&modelId=claude`

    const sessions = await GET_SESSIONS(request(`sessions?${sessionQuery}`), params())
    const audit = await GET_AUDIT(request(`audit?${auditQuery}`), params())

    await expect(readJson(sessions)).resolves.toEqual({ sessions: [{ sessionId: 'session-1' }] })
    await expect(readJson(audit)).resolves.toEqual({ auditEvents: [{ id: 'audit-1' }] })
    expect(mocks.usageDashboardService.listUsageSessions).toHaveBeenCalledWith({
      from: undefined,
      to: new Date('2026-02-01T00:00:00.000Z'),
      userId: undefined,
    })
    expect(mocks.usageDashboardService.listUsageAuditEvents).toHaveBeenCalledWith({
      from: undefined,
      modelId: 'claude',
      providerId: 'anthropic',
      to: new Date('2026-02-01T00:00:00.000Z'),
      userId: undefined,
    })
  })
})

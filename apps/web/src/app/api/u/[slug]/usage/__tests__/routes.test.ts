import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(),
  getSession: vi.fn(),
  isDesktop: vi.fn(),
  providerUsageService: {
    getProviderUsageSummary: vi.fn(),
    listProviderUsageProviders: vi.fn(),
    listProviderUsageUsers: vi.fn(),
  },
  usageDashboardService: {
    listUsageAuditEvents: vi.fn(),
    listUsageSessions: vi.fn(),
  },
  validateDesktopToken: vi.fn(),
  validateSameOrigin: vi.fn(),
}))

vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/services', () => ({
  providerUsageService: mocks.providerUsageService,
  usageDashboardService: mocks.usageDashboardService,
}))

import { GET as getAudit } from '../audit/route'
import { GET as getProviders } from '../providers/route'
import { GET as getSessions } from '../sessions/route'
import { GET as getSummary } from '../summary/route'
import { GET as getUsers } from '../users/route'

type UsageRouteHandler = (
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) => Promise<Response>

const ADMIN_SESSION = {
  sessionId: 'session-admin',
  user: { email: 'admin@test.com', id: 'admin-1', role: 'ADMIN', slug: 'admin' },
}

const USER_SESSION = {
  sessionId: 'session-user',
  user: { email: 'user@test.com', id: 'user-1', role: 'USER', slug: 'admin' },
}

function requestFor(path: string, query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/u/admin/usage/${path}${query}`, { method: 'GET' })
}

function routeParams() {
  return { params: Promise.resolve({ slug: 'admin' }) }
}

function expectDate(value: unknown, expected: string): void {
  expect(value).toBeInstanceOf(Date)
  if (!(value instanceof Date)) {
    throw new Error('Expected Date')
  }
  expect(value.toISOString()).toBe(expected)
}

describe('usage API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: true, flows: true })
    mocks.getSession.mockResolvedValue(ADMIN_SESSION)
    mocks.isDesktop.mockReturnValue(false)
    mocks.providerUsageService.getProviderUsageSummary.mockResolvedValue({ requests: 3 })
    mocks.providerUsageService.listProviderUsageProviders.mockResolvedValue([{ providerId: 'openai' }])
    mocks.providerUsageService.listProviderUsageUsers.mockResolvedValue([{ userId: 'user-1' }])
    mocks.usageDashboardService.listUsageAuditEvents.mockResolvedValue([{ id: 'audit-1' }])
    mocks.usageDashboardService.listUsageSessions.mockResolvedValue([{ sessionId: 'session-1' }])
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
  })

  it('rejects non-admin users for every usage route', async () => {
    mocks.getSession.mockResolvedValue(USER_SESSION)
    const routes: Array<{ handler: UsageRouteHandler; path: string }> = [
      { handler: getAudit, path: 'audit' },
      { handler: getProviders, path: 'providers' },
      { handler: getSessions, path: 'sessions' },
      { handler: getSummary, path: 'summary' },
      { handler: getUsers, path: 'users' },
    ]

    for (const route of routes) {
      const response = await route.handler(requestFor(route.path), routeParams())
      await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
      expect(response.status).toBe(403)
    }

    expect(mocks.providerUsageService.getProviderUsageSummary).not.toHaveBeenCalled()
    expect(mocks.providerUsageService.listProviderUsageProviders).not.toHaveBeenCalled()
    expect(mocks.providerUsageService.listProviderUsageUsers).not.toHaveBeenCalled()
    expect(mocks.usageDashboardService.listUsageAuditEvents).not.toHaveBeenCalled()
    expect(mocks.usageDashboardService.listUsageSessions).not.toHaveBeenCalled()
  })

  it('returns provider usage data with parsed provider filters', async () => {
    const query = '?from=2026-01-01T00:00:00.000Z&to=not-a-date&userId= user-1 &providerId=openai&modelId=gpt-4o'

    const summary = await getSummary(requestFor('summary', query), routeParams())
    const providers = await getProviders(requestFor('providers', query), routeParams())
    const users = await getUsers(requestFor('users', query), routeParams())

    await expect(summary.json()).resolves.toEqual({ summary: { requests: 3 } })
    await expect(providers.json()).resolves.toEqual({ providers: [{ providerId: 'openai' }] })
    await expect(users.json()).resolves.toEqual({ users: [{ userId: 'user-1' }] })

    const expectedFilters = {
      from: new Date('2026-01-01T00:00:00.000Z'),
      modelId: 'gpt-4o',
      providerId: 'openai',
      to: undefined,
      userId: 'user-1',
    }
    expect(mocks.providerUsageService.getProviderUsageSummary).toHaveBeenCalledWith(expectedFilters)
    expect(mocks.providerUsageService.listProviderUsageProviders).toHaveBeenCalledWith(expectedFilters)
    expect(mocks.providerUsageService.listProviderUsageUsers).toHaveBeenCalledWith(expectedFilters)
  })

  it('returns session and audit data with parsed dashboard filters', async () => {
    const sessions = await getSessions(requestFor('sessions', '?from=bad-date&to=2026-05-31T00:00:00.000Z&userId=user-1'), routeParams())
    const audit = await getAudit(requestFor('audit', '?from=2026-05-01T00:00:00.000Z&to=invalid&userId=%20&providerId=anthropic&modelId=claude'), routeParams())

    await expect(sessions.json()).resolves.toEqual({ sessions: [{ sessionId: 'session-1' }] })
    await expect(audit.json()).resolves.toEqual({ auditEvents: [{ id: 'audit-1' }] })

    const sessionFilters = mocks.usageDashboardService.listUsageSessions.mock.calls[0]?.[0]
    expectDate(sessionFilters.to, '2026-05-31T00:00:00.000Z')
    expect(sessionFilters).toMatchObject({ from: undefined, userId: 'user-1' })

    const auditFilters = mocks.usageDashboardService.listUsageAuditEvents.mock.calls[0]?.[0]
    expectDate(auditFilters.from, '2026-05-01T00:00:00.000Z')
    expect(auditFilters).toMatchObject({
      modelId: 'claude',
      providerId: 'anthropic',
      to: undefined,
      userId: undefined,
    })
  })
})

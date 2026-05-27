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
  user: { id: 'admin-1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 'session-admin',
}

const USER_SESSION = {
  user: { id: 'user-1', email: 'user@test.com', slug: 'admin', role: 'USER' },
  sessionId: 'session-user',
}

function requestFor(path: string, query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/u/admin/usage/${path}${query}`, { method: 'GET' })
}

function routeParams() {
  return { params: Promise.resolve({ slug: 'admin' }) }
}

function expectDate(value: unknown, expected: string): void {
  expect(value).toBeInstanceOf(Date)
  expect((value as Date).toISOString()).toBe(expected)
}

describe('usage API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(ADMIN_SESSION)
    mocks.providerUsageService.getProviderUsageSummary.mockResolvedValue({ totalCostUsd: 12 })
    mocks.providerUsageService.listProviderUsageProviders.mockResolvedValue([{ providerId: 'openai' }])
    mocks.providerUsageService.listProviderUsageUsers.mockResolvedValue([{ userId: 'user-1' }])
    mocks.usageDashboardService.listUsageAuditEvents.mockResolvedValue([{ id: 'audit-1' }])
    mocks.usageDashboardService.listUsageSessions.mockResolvedValue([{ id: 'session-1' }])
  })

  it('parses provider usage filters for summary, provider, and user routes', async () => {
    const query = '?from=2026-05-01T00:00:00.000Z&to=bad-date&userId= user-1 &providerId=openai&modelId= '

    const summaryResponse = await getSummary(requestFor('summary', query), routeParams())
    const providersResponse = await getProviders(requestFor('providers', query), routeParams())
    const usersResponse = await getUsers(requestFor('users', query), routeParams())

    await expect(summaryResponse.json()).resolves.toEqual({ summary: { totalCostUsd: 12 } })
    await expect(providersResponse.json()).resolves.toEqual({ providers: [{ providerId: 'openai' }] })
    await expect(usersResponse.json()).resolves.toEqual({ users: [{ userId: 'user-1' }] })

    for (const call of [
      mocks.providerUsageService.getProviderUsageSummary.mock.calls[0]?.[0],
      mocks.providerUsageService.listProviderUsageProviders.mock.calls[0]?.[0],
      mocks.providerUsageService.listProviderUsageUsers.mock.calls[0]?.[0],
    ]) {
      expectDate(call.from, '2026-05-01T00:00:00.000Z')
      expect(call).toMatchObject({
        modelId: undefined,
        providerId: 'openai',
        to: undefined,
        userId: 'user-1',
      })
    }
  })

  it('parses session and audit filters', async () => {
    const query = '?from=2026-05-01T00:00:00.000Z&to=2026-05-02T00:00:00.000Z&userId=user-1&providerId=ollama&modelId=llama3.2'

    const sessionsResponse = await getSessions(requestFor('sessions', query), routeParams())
    const auditResponse = await getAudit(requestFor('audit', query), routeParams())

    await expect(sessionsResponse.json()).resolves.toEqual({ sessions: [{ id: 'session-1' }] })
    await expect(auditResponse.json()).resolves.toEqual({ auditEvents: [{ id: 'audit-1' }] })

    const sessionFilters = mocks.usageDashboardService.listUsageSessions.mock.calls[0]?.[0]
    expectDate(sessionFilters.from, '2026-05-01T00:00:00.000Z')
    expectDate(sessionFilters.to, '2026-05-02T00:00:00.000Z')
    expect(sessionFilters).toMatchObject({ userId: 'user-1' })

    const auditFilters = mocks.usageDashboardService.listUsageAuditEvents.mock.calls[0]?.[0]
    expectDate(auditFilters.from, '2026-05-01T00:00:00.000Z')
    expectDate(auditFilters.to, '2026-05-02T00:00:00.000Z')
    expect(auditFilters).toMatchObject({
      modelId: 'llama3.2',
      providerId: 'ollama',
      userId: 'user-1',
    })
  })

  it('requires admin access for every usage route', async () => {
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
  })
})

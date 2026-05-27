import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(),
  getSession: vi.fn(),
  isDesktop: vi.fn(),
  listProviderUsageProviders: vi.fn(),
  listProviderUsageUsers: vi.fn(),
  listUsageAuditEvents: vi.fn(),
  listUsageSessions: vi.fn(),
  getProviderUsageSummary: vi.fn(),
  validateDesktopToken: vi.fn(),
}))

vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/services', () => ({
  providerUsageService: {
    getProviderUsageSummary: mocks.getProviderUsageSummary,
    listProviderUsageProviders: mocks.listProviderUsageProviders,
    listProviderUsageUsers: mocks.listProviderUsageUsers,
  },
  usageDashboardService: {
    listUsageAuditEvents: mocks.listUsageAuditEvents,
    listUsageSessions: mocks.listUsageSessions,
  },
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

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`)
}

function params(slug = 'admin') {
  return { params: Promise.resolve({ slug }) }
}

describe('usage dashboard API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: true, flows: true })
    mocks.getSession.mockResolvedValue(ADMIN_SESSION)
    mocks.isDesktop.mockReturnValue(false)
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.getProviderUsageSummary.mockResolvedValue({ totalCostUsd: 12 })
    mocks.listProviderUsageProviders.mockResolvedValue([{ providerId: 'openai' }])
    mocks.listProviderUsageUsers.mockResolvedValue([{ userId: 'user-1' }])
    mocks.listUsageSessions.mockResolvedValue([{ sessionId: 'session-2' }])
    mocks.listUsageAuditEvents.mockResolvedValue([{ id: 'audit-1' }])
  })

  it('blocks non-admin users before loading usage data', async () => {
    mocks.getSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      user: { email: 'alice@example.com', id: 'user-1', role: 'USER', slug: 'alice' },
    })

    const response = await GET_SUMMARY(request('/api/u/alice/usage/summary'), params('alice'))

    expect(response.status).toBe(403)
    expect(mocks.getProviderUsageSummary).not.toHaveBeenCalled()
  })

  it('passes parsed provider filters to provider usage routes', async () => {
    const path = '/api/u/admin/usage/summary?from=2026-05-01T00:00:00.000Z&to=2026-05-31T00:00:00.000Z&userId=user-1&providerId=openai&modelId=gpt-5.5'
    const expectedFilters = {
      from: new Date('2026-05-01T00:00:00.000Z'),
      modelId: 'gpt-5.5',
      providerId: 'openai',
      to: new Date('2026-05-31T00:00:00.000Z'),
      userId: 'user-1',
    }

    await expect((await GET_SUMMARY(request(path), params())).json()).resolves.toEqual({ summary: { totalCostUsd: 12 } })
    await expect((await GET_PROVIDERS(request(path.replace('/summary', '/providers')), params())).json()).resolves.toEqual({ providers: [{ providerId: 'openai' }] })
    await expect((await GET_USERS(request(path.replace('/summary', '/users')), params())).json()).resolves.toEqual({ users: [{ userId: 'user-1' }] })

    expect(mocks.getProviderUsageSummary).toHaveBeenCalledWith(expectedFilters)
    expect(mocks.listProviderUsageProviders).toHaveBeenCalledWith(expectedFilters)
    expect(mocks.listProviderUsageUsers).toHaveBeenCalledWith(expectedFilters)
  })

  it('passes parsed session and audit filters to usage dashboard routes', async () => {
    await expect((await GET_SESSIONS(request('/api/u/admin/usage/sessions?from=invalid&to=2026-05-31T00:00:00.000Z&userId=user-1'), params())).json())
      .resolves.toEqual({ sessions: [{ sessionId: 'session-2' }] })
    await expect((await GET_AUDIT(request('/api/u/admin/usage/audit?from=2026-05-01T00:00:00.000Z&to=invalid&userId=%20&providerId=anthropic&modelId=claude'), params())).json())
      .resolves.toEqual({ auditEvents: [{ id: 'audit-1' }] })

    expect(mocks.listUsageSessions).toHaveBeenCalledWith({
      from: undefined,
      to: new Date('2026-05-31T00:00:00.000Z'),
      userId: 'user-1',
    })
    expect(mocks.listUsageAuditEvents).toHaveBeenCalledWith({
      from: new Date('2026-05-01T00:00:00.000Z'),
      modelId: 'claude',
      providerId: 'anthropic',
      to: undefined,
      userId: undefined,
    })
  })
})

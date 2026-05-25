import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  auditEvent: {
    findMany: vi.fn(),
  },
  session: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

import { listUsageAuditEvents, listUsageSessions } from '../usage-dashboard'

describe('usageDashboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists sessions with filters and normalized durations', async () => {
    mockPrisma.session.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-05-17T10:00:00.000Z'),
        expiresAt: new Date('2026-05-18T10:00:00.000Z'),
        id: 'session-1',
        ip: '127.0.0.1',
        lastSeenAt: new Date('2026-05-17T10:10:00.000Z'),
        revokedAt: null,
        user: { id: 'u1', email: 'alice@example.com', slug: 'alice' },
        userAgent: 'Vitest',
        userId: 'u1',
      },
      {
        createdAt: new Date('2026-05-17T11:00:00.000Z'),
        expiresAt: new Date('2026-05-18T11:00:00.000Z'),
        id: 'session-2',
        ip: null,
        lastSeenAt: null,
        revokedAt: new Date('2026-05-17T10:59:00.000Z'),
        user: null,
        userAgent: null,
        userId: 'u2',
      },
    ])

    await expect(listUsageSessions({
      from: new Date('2026-05-17T00:00:00.000Z'),
      to: new Date('2026-05-18T00:00:00.000Z'),
      userId: 'u1',
    })).resolves.toEqual([
      {
        createdAt: '2026-05-17T10:00:00.000Z',
        durationMs: 600_000,
        expiresAt: '2026-05-18T10:00:00.000Z',
        id: 'session-1',
        ip: '127.0.0.1',
        lastSeenAt: '2026-05-17T10:10:00.000Z',
        revokedAt: null,
        user: { id: 'u1', email: 'alice@example.com', slug: 'alice' },
        userAgent: 'Vitest',
        userId: 'u1',
      },
      {
        createdAt: '2026-05-17T11:00:00.000Z',
        durationMs: 0,
        expiresAt: '2026-05-18T11:00:00.000Z',
        id: 'session-2',
        ip: null,
        lastSeenAt: null,
        revokedAt: '2026-05-17T10:59:00.000Z',
        user: null,
        userAgent: null,
        userId: 'u2',
      },
    ])
    expect(mockPrisma.session.findMany).toHaveBeenCalledWith({
      include: { user: { select: { email: true, id: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      where: {
        createdAt: {
          gte: new Date('2026-05-17T00:00:00.000Z'),
          lte: new Date('2026-05-18T00:00:00.000Z'),
        },
        userId: 'u1',
      },
    })
  })

  it('filters audit events by provider and model metadata', async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      {
        action: 'provider.request',
        actorUser: { id: 'u1', email: 'alice@example.com', slug: 'alice' },
        actorUserId: 'u1',
        createdAt: new Date('2026-05-17T10:00:00.000Z'),
        id: 'audit-1',
        metadata: { modelId: 'gpt-5.5', providerId: 'openai' },
      },
      {
        action: 'provider.request',
        actorUser: null,
        actorUserId: null,
        createdAt: new Date('2026-05-17T11:00:00.000Z'),
        id: 'audit-2',
        metadata: { modelId: 'claude', providerId: 'anthropic' },
      },
      {
        action: 'provider.request',
        actorUser: null,
        actorUserId: null,
        createdAt: new Date('2026-05-17T12:00:00.000Z'),
        id: 'audit-3',
        metadata: null,
      },
    ])

    await expect(listUsageAuditEvents({
      modelId: 'gpt-5.5',
      providerId: 'openai',
      userId: 'u1',
    })).resolves.toEqual([
      {
        action: 'provider.request',
        actorUser: { id: 'u1', email: 'alice@example.com', slug: 'alice' },
        actorUserId: 'u1',
        createdAt: '2026-05-17T10:00:00.000Z',
        id: 'audit-1',
        metadata: { modelId: 'gpt-5.5', providerId: 'openai' },
      },
    ])
    expect(mockPrisma.auditEvent.findMany).toHaveBeenCalledWith({
      include: { actorUser: { select: { email: true, id: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      where: { actorUserId: 'u1' },
    })
  })

  it('returns all audit events when metadata filters are absent', async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([
      {
        action: 'system.event',
        actorUser: null,
        actorUserId: null,
        createdAt: new Date('2026-05-17T10:00:00.000Z'),
        id: 'audit-1',
        metadata: ['not', 'an', 'object'],
      },
    ])

    await expect(listUsageAuditEvents({})).resolves.toEqual([
      {
        action: 'system.event',
        actorUser: null,
        actorUserId: null,
        createdAt: '2026-05-17T10:00:00.000Z',
        id: 'audit-1',
        metadata: ['not', 'an', 'object'],
      },
    ])
  })
})

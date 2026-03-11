import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock runtime session
vi.mock('@/lib/runtime/session', () => ({
  getSession: vi.fn(),
}))

// Mock prisma (imported by actions for provider sync)
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}))

// Mock opencode client (imported by ensureInstanceRunningAction for getInstanceBasicAuth)
vi.mock('@/lib/opencode/client', () => ({
  getInstanceBasicAuth: vi.fn().mockResolvedValue({
    baseUrl: 'http://opencode-alice:4096',
    authHeader: 'Basic dGVzdA==',
  }),
}))

// Mock provider sync (imported by ensureInstanceRunningAction)
vi.mock('@/lib/opencode/providers', () => ({
  syncProviderAccessForInstance: vi.fn().mockResolvedValue({ ok: true }),
}))

// Mock spawner core
vi.mock('@/lib/spawner/core', () => ({
  startInstance: vi.fn(),
  stopInstance: vi.fn(),
  getInstanceStatus: vi.fn(),
  isSlowStart: vi.fn(() => false),
}))

const mockGetKickstartStatus = vi.fn()
vi.mock('@/kickstart/status', () => ({
  getKickstartStatus: (...args: unknown[]) => mockGetKickstartStatus(...args),
}))

import { getSession } from '@/lib/runtime/session'
import { prisma } from '@/lib/prisma'
import { getInstanceBasicAuth } from '@/lib/opencode/client'
import { startInstance, stopInstance, getInstanceStatus } from '@/lib/spawner/core'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { startInstanceAction, stopInstanceAction, getInstanceStatusAction, ensureInstanceRunningAction } from '../spawner'

const mockGetSession = vi.mocked(getSession)
const mockStart = vi.mocked(startInstance)
const mockStop = vi.mocked(stopInstance)
const mockStatus = vi.mocked(getInstanceStatus)
const mockPrisma = vi.mocked(prisma)
const mockGetInstanceBasicAuth = vi.mocked(getInstanceBasicAuth)
const mockSync = vi.mocked(syncProviderAccessForInstance)

const fakeSession = {
  user: { id: 'user-1', email: 'alice@test.com', slug: 'alice', role: 'USER' },
  sessionId: 'sess-1',
}

const adminSession = {
  user: { id: 'admin-1', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 'sess-2',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetKickstartStatus.mockResolvedValue('ready')
})

describe('startInstanceAction', () => {
  it('returns unauthorized without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await startInstanceAction('alice')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns forbidden if slug does not match and not admin', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    const result = await startInstanceAction('bob')
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('allows admin to start any instance', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    mockStart.mockResolvedValue({ ok: true, status: 'running' })
    const result = await startInstanceAction('alice')
    expect(result).toEqual({ ok: true, status: 'running' })
  })

  it('allows user to start own instance', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStart.mockResolvedValue({ ok: true, status: 'running' })
    const result = await startInstanceAction('alice')
    expect(result).toEqual({ ok: true, status: 'running' })
    expect(mockStart).toHaveBeenCalledWith('alice', 'user-1')
  })

  it('returns setup_required when kickstart is incomplete', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockGetKickstartStatus.mockResolvedValue('needs_setup')

    const result = await startInstanceAction('alice')
    expect(result).toEqual({ ok: false, error: 'setup_required' })
    expect(mockStart).not.toHaveBeenCalled()
  })
})

describe('stopInstanceAction', () => {
  it('returns unauthorized without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await stopInstanceAction('alice')
    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns forbidden if slug does not match and not admin', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    const result = await stopInstanceAction('bob')
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('allows user to stop own instance', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStop.mockResolvedValue({ ok: true, status: 'stopped' })
    const result = await stopInstanceAction('alice')
    expect(result).toEqual({ ok: true, status: 'stopped' })
  })
})

describe('getInstanceStatusAction', () => {
  it('returns null without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await getInstanceStatusAction('alice')
    expect(result).toBeNull()
  })

  it('returns default stopped when no instance exists', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue(null)
    const result = await getInstanceStatusAction('alice')
    expect(result).toEqual({ status: 'stopped', slowStart: false })
  })

  it('returns instance status with slowStart flag', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({
      status: 'running',
      startedAt: new Date(),
      stoppedAt: null,
      lastActivityAt: new Date(),
    } as never)
    const result = await getInstanceStatusAction('alice')
    expect(result).toMatchObject({ status: 'running', slowStart: false })
  })
})

describe('ensureInstanceRunningAction', () => {
  it('returns unauthorized without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await ensureInstanceRunningAction('alice')
    expect(result).toEqual({ status: 'error', error: 'unauthorized' })
  })

  it('returns running and syncs providers when instance is already running (own slug)', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockGetInstanceBasicAuth).toHaveBeenCalledWith('alice')
    expect(mockSync).toHaveBeenCalledWith({
      instance: expect.objectContaining({ baseUrl: expect.any(String), authHeader: expect.any(String) }),
      slug: 'alice',
      userId: 'user-1',
    })
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('skips provider sync when instance just started', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockStatus.mockResolvedValue({
      status: 'running',
      startedAt: new Date(),
    } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('syncs providers against the workspace owner when admin opens another slug', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    mockStatus.mockResolvedValue({ status: 'running' } as never)
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-alice' } as never)

    const result = await ensureInstanceRunningAction('alice')

    expect(result).toEqual({ status: 'running' })
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { slug: 'alice' }, select: { id: true } })
    expect(mockSync).toHaveBeenCalledWith({
      instance: expect.objectContaining({ baseUrl: expect.any(String), authHeader: expect.any(String) }),
      slug: 'alice',
      userId: 'user-alice',
    })
  })

  it('returns setup_required when kickstart is incomplete', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockGetKickstartStatus.mockResolvedValue('needs_setup')

    const result = await ensureInstanceRunningAction('alice')
    expect(result).toEqual({ status: 'error', error: 'setup_required' })
    expect(mockStatus).not.toHaveBeenCalled()
  })
})

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false, flows: true })),
  getSession: vi.fn(),
  isDesktop: vi.fn(() => false),
  prisma: {
    slackUserLink: {
      findMany: vi.fn(),
    },
  },
  requireCapability: vi.fn(() => null),
  slackService: {
    findIntegration: vi.fn(),
    listEnabledNotificationChannels: vi.fn(),
  },
  userService: {
    findIdentityBySlug: vi.fn(),
    findTeamMembers: vi.fn(),
  },
  validateDesktopToken: vi.fn(() => true),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
}))

vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/require-capability', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/services', () => ({
  slackService: mocks.slackService,
  userService: mocks.userService,
}))

import { GET } from '../route'

const USER_SESSION = {
  user: { email: 'alice@test.com', id: 'u-alice', role: 'USER', slug: 'alice' },
  sessionId: 'session-1',
}

function makeRequest(slug = 'alice') {
  return new NextRequest(`http://localhost/api/u/${slug}/flows/slack-targets`, {
    method: 'GET',
  })
}

function slugParams(slug = 'alice') {
  return { params: Promise.resolve({ slug }) }
}

describe('/api/u/[slug]/flows/slack-targets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false, flows: true })
    mocks.getSession.mockResolvedValue(USER_SESSION)
    mocks.isDesktop.mockReturnValue(false)
    mocks.prisma.slackUserLink.findMany.mockResolvedValue([{ userId: 'u-alice' }])
    mocks.requireCapability.mockReturnValue(null)
    mocks.slackService.findIntegration.mockResolvedValue({ enabled: true, slackTeamId: 'T123' })
    mocks.slackService.listEnabledNotificationChannels.mockResolvedValue([
      { channelId: 'C1', isPrivate: false, name: 'general' },
      { channelId: 'G1', isPrivate: true, name: 'private-team' },
    ])
    mocks.userService.findIdentityBySlug.mockResolvedValue({ email: 'alice@test.com', id: 'u-alice' })
    mocks.userService.findTeamMembers.mockResolvedValue([
      { email: 'alice@test.com', id: 'u-alice' },
      { email: 'bob@test.com', id: 'u-bob' },
    ])
    mocks.validateDesktopToken.mockReturnValue(true)
  })

  it('returns the current user and enabled notification channels for non-admins', async () => {
    const res = await GET(makeRequest(), slugParams())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      channels: [
        { channelId: 'C1', isPrivate: false, name: 'general' },
      ],
      integrationEnabled: true,
      users: [
        { email: 'alice@test.com', id: 'u-alice', slackLinked: true },
      ],
    })
    expect(mocks.prisma.slackUserLink.findMany).toHaveBeenCalledWith({
      select: { userId: true },
      where: { userId: { in: ['u-alice'] } },
    })
    expect(mocks.userService.findTeamMembers).not.toHaveBeenCalled()
    expect(mocks.slackService.listEnabledNotificationChannels).toHaveBeenCalledWith('T123')
  })

  it('returns all team members for admins', async () => {
    mocks.getSession.mockResolvedValue({
      user: { email: 'admin@test.com', id: 'u-admin', role: 'ADMIN', slug: 'admin' },
      sessionId: 'session-admin',
    })

    const res = await GET(makeRequest(), slugParams())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.channels).toEqual([
      { channelId: 'C1', isPrivate: false, name: 'general' },
      { channelId: 'G1', isPrivate: true, name: 'private-team' },
    ])
    expect(body.users).toEqual([
      { email: 'alice@test.com', id: 'u-alice', slackLinked: true },
      { email: 'bob@test.com', id: 'u-bob', slackLinked: false },
    ])
    expect(mocks.prisma.slackUserLink.findMany).toHaveBeenCalledWith({
      select: { userId: true },
      where: { userId: { in: ['u-alice', 'u-bob'] } },
    })
  })

  it('returns no channels when Slack integration is disabled', async () => {
    mocks.slackService.findIntegration.mockResolvedValue({ enabled: false, slackTeamId: 'T123' })

    const res = await GET(makeRequest(), slugParams())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.integrationEnabled).toBe(false)
    expect(body.channels).toEqual([])
    expect(mocks.slackService.listEnabledNotificationChannels).not.toHaveBeenCalled()
  })

  it('returns the capability denial response', async () => {
    mocks.requireCapability.mockReturnValue(Response.json({ error: 'disabled' }, { status: 503 }))

    const res = await GET(makeRequest(), slugParams())

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'disabled' })
  })

  it('returns 404 when the workspace user is missing', async () => {
    mocks.getSession.mockResolvedValue({
      user: { email: 'admin@test.com', id: 'u-admin', role: 'ADMIN', slug: 'admin' },
      sessionId: 'session-admin',
    })
    mocks.userService.findIdentityBySlug.mockResolvedValue(null)

    const res = await GET(makeRequest('missing'), slugParams('missing'))

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'not_found' })
  })

  it('returns 403 when a user requests another workspace', async () => {
    mocks.getSession.mockResolvedValue({
      user: { email: 'bob@test.com', id: 'u-bob', role: 'USER', slug: 'alice' },
      sessionId: 'session-2',
    })
    mocks.userService.findIdentityBySlug.mockResolvedValue({ email: 'alice@test.com', id: 'u-alice' })

    const res = await GET(makeRequest('alice'), slugParams('alice'))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('returns 500 when target loading fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.prisma.slackUserLink.findMany.mockRejectedValue(new Error('db down'))

    const res = await GET(makeRequest(), slugParams())

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'internal_error' })
    errorSpy.mockRestore()
  })
})

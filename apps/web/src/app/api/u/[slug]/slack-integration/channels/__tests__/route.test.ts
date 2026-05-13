import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auditEvent: vi.fn(),
  callSlackApi: vi.fn(),
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  getSession: vi.fn(),
  isDesktop: vi.fn(() => false),
  requireSlackIntegrationAdmin: vi.fn(() => ({ ok: true })),
  slackService: {
    findIntegration: vi.fn(),
    listNotificationChannels: vi.fn(),
    setNotificationChannelEnabledById: vi.fn(),
    upsertNotificationChannelsFromSlack: vi.fn(),
  },
  validateDesktopToken: vi.fn(() => true),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
}))

vi.mock('@/lib/auth', () => ({ auditEvent: mocks.auditEvent }))
vi.mock('@/lib/csrf', () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock('@/lib/runtime/capabilities', () => ({ getRuntimeCapabilities: mocks.getRuntimeCapabilities }))
vi.mock('@/lib/runtime/desktop/token', () => ({
  DESKTOP_TOKEN_HEADER: 'x-arche-desktop-token',
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/runtime/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/slack/route-auth', () => ({
  requireSlackIntegrationAdmin: mocks.requireSlackIntegrationAdmin,
}))
vi.mock('@/lib/slack/web-api', () => ({ callSlackApi: mocks.callSlackApi }))
vi.mock('@/lib/services', () => ({ slackService: mocks.slackService }))

import { GET, PATCH, POST } from '../route'

const ADMIN_SESSION = {
  user: { id: 'u-admin', email: 'admin@test.com', slug: 'admin', role: 'ADMIN' },
  sessionId: 'session-1',
}

function makeRequest(method: 'GET' | 'PATCH' | 'POST', body?: unknown) {
  return new NextRequest('http://localhost/api/u/admin/slack-integration/channels', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
  })
}

function slugParams(slug = 'admin') {
  return { params: Promise.resolve({ slug }) }
}

describe('/api/u/[slug]/slack-integration/channels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auditEvent.mockResolvedValue(undefined)
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false })
    mocks.getSession.mockResolvedValue(ADMIN_SESSION)
    mocks.isDesktop.mockReturnValue(false)
    mocks.requireSlackIntegrationAdmin.mockReturnValue({ ok: true })
    mocks.slackService.findIntegration.mockResolvedValue({
      botTokenSecret: 'xoxb-token',
      enabled: true,
      slackTeamId: 'T123',
    })
    mocks.slackService.listNotificationChannels.mockResolvedValue([])
    mocks.slackService.setNotificationChannelEnabledById.mockResolvedValue(undefined)
    mocks.slackService.upsertNotificationChannelsFromSlack.mockResolvedValue(undefined)
    mocks.validateDesktopToken.mockReturnValue(true)
    mocks.validateSameOrigin.mockReturnValue({ ok: true })
  })

  describe('GET', () => {
    it('returns stored channels for an enabled integration', async () => {
      const channels = [{ id: 'row-1', channelId: 'C1', name: 'general', isPrivate: false }]
      mocks.slackService.listNotificationChannels.mockResolvedValue(channels)

      const res = await GET(makeRequest('GET'), slugParams())

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ channels })
      expect(mocks.slackService.listNotificationChannels).toHaveBeenCalledWith('T123')
    })

    it('returns an empty list when Slack is disabled', async () => {
      mocks.slackService.findIntegration.mockResolvedValue({ enabled: false, slackTeamId: 'T123' })

      const res = await GET(makeRequest('GET'), slugParams())

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ channels: [] })
      expect(mocks.slackService.listNotificationChannels).not.toHaveBeenCalled()
    })

    it('returns the Slack admin guard response', async () => {
      mocks.requireSlackIntegrationAdmin.mockReturnValue({
        ok: false,
        response: Response.json({ error: 'forbidden' }, { status: 403 }),
      })

      const res = await GET(makeRequest('GET'), slugParams())

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({ error: 'forbidden' })
    })

    it('returns 500 when channel loading fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.slackService.listNotificationChannels.mockRejectedValue(new Error('db down'))

      const res = await GET(makeRequest('GET'), slugParams())

      expect(res.status).toBe(500)
      await expect(res.json()).resolves.toEqual({ error: 'internal_error' })
      errorSpy.mockRestore()
    })
  })

  describe('POST', () => {
    it('refreshes joined Slack channels and audits the result', async () => {
      mocks.callSlackApi
        .mockResolvedValueOnce({
          ok: true,
          channels: [
            { id: 'C1', name: 'general' },
            { id: 'C2', is_member: true, is_private: true, name: 'ops' },
            { id: 'C-missing-name' },
            { name: 'missing-id' },
          ],
          response_metadata: { next_cursor: 'next-cursor' },
        })
        .mockResolvedValueOnce({
          ok: true,
          channels: [{ id: 'C3', name: 'random' }],
          response_metadata: { next_cursor: '  ' },
        })
        .mockResolvedValueOnce({
          ok: true,
          channels: [
            { id: 'G1', is_member: true, name: 'private-team' },
            { id: 'G2', is_member: false, name: 'outside-private' },
            { id: 'G3', name: 'incident-room' },
          ],
        })

      const res = await POST(makeRequest('POST'), slugParams())

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ ok: true })
      expect(mocks.callSlackApi).toHaveBeenNthCalledWith(1, 'conversations.list', 'xoxb-token', {
        body: {
          cursor: undefined,
          exclude_archived: true,
          limit: 200,
          types: 'public_channel',
        },
        contentType: 'json',
      })
      expect(mocks.callSlackApi).toHaveBeenNthCalledWith(2, 'conversations.list', 'xoxb-token', {
        body: {
          cursor: 'next-cursor',
          exclude_archived: true,
          limit: 200,
          types: 'public_channel',
        },
        contentType: 'json',
      })
      expect(mocks.slackService.upsertNotificationChannelsFromSlack).toHaveBeenCalledWith('T123', [
        { channelId: 'C1', isPrivate: false, name: 'general' },
        { channelId: 'C2', isPrivate: true, name: 'ops' },
        { channelId: 'C3', isPrivate: false, name: 'random' },
        { channelId: 'G1', isPrivate: true, name: 'private-team' },
        { channelId: 'G3', isPrivate: true, name: 'incident-room' },
      ])
      expect(mocks.auditEvent).toHaveBeenCalledWith({
        actorUserId: 'u-admin',
        action: 'slack.notification_channels_refreshed',
        metadata: {
          channelCount: 5,
          slackTeamId: 'T123',
        },
      })
    })

    it('returns 400 when Slack integration cannot refresh channels', async () => {
      mocks.slackService.findIntegration.mockResolvedValue({ enabled: true, slackTeamId: 'T123' })

      const res = await POST(makeRequest('POST'), slugParams())

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: 'slack_integration_disabled' })
    })

    it('returns 500 when Slack channel refresh fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.callSlackApi.mockRejectedValue(new Error('slack_down'))

      const res = await POST(makeRequest('POST'), slugParams())

      expect(res.status).toBe(500)
      await expect(res.json()).resolves.toEqual({ error: 'internal_error' })
      errorSpy.mockRestore()
    })
  })

  describe('PATCH', () => {
    it('updates a channel enabled flag by record id and audits', async () => {
      const res = await PATCH(makeRequest('PATCH', { enabled: false, id: ' row-1 ' }), slugParams())

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ ok: true })
      expect(mocks.slackService.setNotificationChannelEnabledById).toHaveBeenCalledWith('row-1', false)
      expect(mocks.auditEvent).toHaveBeenCalledWith({
        actorUserId: 'u-admin',
        action: 'slack.notification_channel_updated',
        metadata: {
          channelRecordId: 'row-1',
          enabled: false,
        },
      })
    })

    it('returns 400 for invalid update payloads', async () => {
      const res = await PATCH(makeRequest('PATCH', { enabled: 'yes', id: 'row-1' }), slugParams())

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: 'invalid_request' })
      expect(mocks.slackService.setNotificationChannelEnabledById).not.toHaveBeenCalled()
    })

    it('returns 400 for non-object update payloads', async () => {
      const res = await PATCH(makeRequest('PATCH', ['row-1']), slugParams())

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: 'invalid_request' })
    })

    it('returns 500 when the update fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.slackService.setNotificationChannelEnabledById.mockRejectedValue(new Error('db down'))

      const res = await PATCH(makeRequest('PATCH', { enabled: true, id: 'row-1' }), slugParams())

      expect(res.status).toBe(500)
      await expect(res.json()).resolves.toEqual({ error: 'internal_error' })
      errorSpy.mockRestore()
    })
  })
})

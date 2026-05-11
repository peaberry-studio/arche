import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
  },
  slackUserLink: {
    findFirst: vi.fn(),
  },
}))

const mocks = vi.hoisted(() => ({
  auditService: {
    createEvent: vi.fn(),
  },
  slackService: {
    findIntegration: vi.fn(),
    isNotificationChannelAllowed: vi.fn(),
    upsertUserLink: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/services', () => ({
  auditService: mocks.auditService,
  slackService: mocks.slackService,
}))

describe('Slack notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    mocks.slackService.findIntegration.mockResolvedValue({
      botTokenSecret: 'xoxb-token',
      enabled: true,
      slackTeamId: 'T123',
    })
    mocks.slackService.isNotificationChannelAllowed.mockResolvedValue(true)
    mocks.auditService.createEvent.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a channel notification only when the channel is allowlisted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)

    const { sendSlackNotifications } = await import('../notifications')
    const result = await sendSlackNotifications({
      source: 'autopilot',
      targets: [{ type: 'channel', channelId: 'C123' }],
      text: 'Report',
    })

    expect(result).toEqual({ ok: true, sent: 1, failed: 0, errors: [] })
    expect(mocks.slackService.isNotificationChannelAllowed).toHaveBeenCalledWith('T123', 'C123')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({ body: JSON.stringify({ channel: 'C123', text: 'Report' }) }),
    )
  })

  it('resolves DM targets by email when no Slack link exists', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        user: {
          id: 'U123',
          profile: { display_name: 'Alice', email: 'alice@test.com' },
        },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, channel: { id: 'D123' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', email: 'alice@test.com' })
    mockPrisma.slackUserLink.findFirst.mockResolvedValue(null)
    mocks.slackService.upsertUserLink.mockResolvedValue({ slackUserId: 'U123' })

    const { sendSlackNotifications } = await import('../notifications')
    const result = await sendSlackNotifications({
      source: 'autopilot',
      targets: [{ type: 'dm', userId: 'user-1' }],
      text: 'Report',
    })

    expect(result).toMatchObject({ ok: true, sent: 1, failed: 0 })
    expect(mocks.slackService.upsertUserLink).toHaveBeenCalledWith({
      displayName: 'Alice',
      slackEmail: 'alice@test.com',
      slackTeamId: 'T123',
      slackUserId: 'U123',
      userId: 'user-1',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

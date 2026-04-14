import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('slack integration helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('serializes an enabled integration with connected status', async () => {
    const { serializeSlackIntegration } = await import('../integration')

    const result = serializeSlackIntegration(
      {
        appTokenSecret: 'enc-app',
        botTokenSecret: 'enc-bot',
        createdAt: new Date('2026-04-13T10:00:00.000Z'),
        defaultAgentId: 'researcher',
        enabled: true,
        lastError: null,
        lastEventAt: new Date('2026-04-13T10:10:00.000Z'),
        lastSocketConnectedAt: new Date('2026-04-13T10:05:00.000Z'),
        singletonKey: 'default',
        slackAppId: 'A123',
        slackBotUserId: 'U123',
        slackTeamId: 'T123',
        updatedAt: new Date('2026-04-13T10:15:00.000Z'),
        version: 7,
      },
      'assistant',
    )

    expect(result).toEqual({
      configured: true,
      defaultAgentId: 'researcher',
      enabled: true,
      hasAppToken: true,
      hasBotToken: true,
      lastError: null,
      lastEventAt: '2026-04-13T10:10:00.000Z',
      lastSocketConnectedAt: '2026-04-13T10:05:00.000Z',
      resolvedDefaultAgentId: 'researcher',
      slackAppId: 'A123',
      slackBotUserId: 'U123',
      slackTeamId: 'T123',
      status: 'connected',
      updatedAt: '2026-04-13T10:15:00.000Z',
      version: 7,
    })
  })

  it('tests Slack credentials through the HTTP API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, team_id: 'T123', user_id: 'U123' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, url: 'wss://socket.slack.test/link/?ticket=123&app_id=A123' })))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, url: 'wss://socket.slack.test/link/?ticket=123&app_id=A123' })))
    vi.stubGlobal('fetch', fetchMock)

    const { testSlackCredentials } = await import('../integration')
    const result = await testSlackCredentials({ appToken: 'xapp-1', botToken: 'xoxb-1' })

    expect(result).toEqual({
      appId: 'A123',
      botUserId: 'U123',
      ok: true,
      socketUrlAvailable: true,
      teamId: 'T123',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

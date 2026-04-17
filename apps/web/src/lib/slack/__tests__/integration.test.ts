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
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot_id: 'B123', team_id: 'T123', user_id: 'U123' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot: { app_id: 'A123' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, url: 'wss://socket.slack.test/link/?ticket=123&app_id=A123' })))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, url: 'wss://socket.slack.test/link/?ticket=123&app_id=A123' })))
    vi.stubGlobal('fetch', fetchMock)

    const { testSlackCredentials } = await import('../integration')
    const result = await testSlackCredentials({ appToken: 'xapp-1-A123-token', botToken: 'xoxb-1' })

    expect(result).toEqual({
      appId: 'A123',
      botUserId: 'U123',
      ok: true,
      socketUrlAvailable: true,
      teamId: 'T123',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects Slack credentials when the bot token belongs to a different app', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot_id: 'B123', team_id: 'T123', user_id: 'U123' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot: { app_id: 'A123' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, url: 'wss://socket.slack.test/link/?ticket=123&app_id=53513cf46490c17413a96039a118aaf4e4c42749e08afcfb0ac64e4e66e46d02' })))
    vi.stubGlobal('fetch', fetchMock)

    const { testSlackCredentials } = await import('../integration')

    await expect(testSlackCredentials({ appToken: 'xapp-1-A999-token', botToken: 'xoxb-1' })).rejects.toThrow(
      'slack_app_mismatch',
    )
  })

  it('accepts valid credentials when Slack returns an opaque socket app identifier', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot_id: 'B123', team_id: 'T123', user_id: 'U123' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot: { app_id: 'A123' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, url: 'wss://socket.slack.test/link/?ticket=123&app_id=53513cf46490c17413a96039a118aaf4e4c42749e08afcfb0ac64e4e66e46d02' })))
    vi.stubGlobal('fetch', fetchMock)

    const { testSlackCredentials } = await import('../integration')
    const result = await testSlackCredentials({ appToken: 'xapp-1-A123-token', botToken: 'xoxb-1' })

    expect(result).toEqual({
      appId: 'A123',
      botUserId: 'U123',
      ok: true,
      socketUrlAvailable: true,
      teamId: 'T123',
    })
  })

  it('applies a timeout to each Slack API request', async () => {
    const timeoutSignal = new AbortController().signal
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot_id: 'B123', team_id: 'T123', user_id: 'U123' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot: { app_id: 'A123' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, url: 'wss://socket.slack.test/link/?ticket=123&app_id=A123' })))
    vi.stubGlobal('fetch', fetchMock)

    const { testSlackCredentials } = await import('../integration')
    await testSlackCredentials({ appToken: 'xapp-1-A123-token', botToken: 'xoxb-1' })

    expect(timeoutSpy).toHaveBeenCalledWith(10_000)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/auth.test',
      expect.objectContaining({ signal: timeoutSignal }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/bots.info',
      expect.objectContaining({ signal: timeoutSignal }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/apps.connections.open',
      expect.objectContaining({ signal: timeoutSignal }),
    )
  })
})

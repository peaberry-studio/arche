import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SlackIntegrationRecord } from '@/lib/services/slack'

function createSlackRecord(overrides: Partial<SlackIntegrationRecord> = {}): SlackIntegrationRecord {
  return {
    appTokenSecret: null,
    botTokenSecret: null,
    createdAt: new Date('2026-04-13T10:00:00.000Z'),
    defaultAgentId: null,
    enabled: true,
    lastError: null,
    lastEventAt: null,
    lastSocketConnectedAt: null,
    singletonKey: 'default',
    slackAppId: null,
    slackBotUserId: null,
    slackTeamId: null,
    updatedAt: new Date('2026-04-13T10:00:00.000Z'),
    version: 1,
    ...overrides,
  }
}

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

  it('serializes disabled, error, and connecting integration states', async () => {
    const { getSlackIntegrationStatus, isSlackAppToken, isSlackBotToken, serializeSlackIntegration } = await import('../integration')

    expect(getSlackIntegrationStatus(null)).toBe('disabled')
    expect(getSlackIntegrationStatus(createSlackRecord({ enabled: false }))).toBe('disabled')
    expect(getSlackIntegrationStatus(createSlackRecord({ lastError: 'boom' }))).toBe('error')
    expect(getSlackIntegrationStatus(createSlackRecord())).toBe('connecting')
    expect(isSlackBotToken('xoxb-token')).toBe(true)
    expect(isSlackBotToken('xapp-token')).toBe(false)
    expect(isSlackAppToken('xapp-token')).toBe(true)
    expect(isSlackAppToken('xoxb-token')).toBe(false)

    expect(serializeSlackIntegration(null, 'assistant')).toMatchObject({
      configured: false,
      enabled: false,
      resolvedDefaultAgentId: 'assistant',
      status: 'disabled',
      version: 0,
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

  it('falls back to the socket app id when token and bot metadata omit one', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot_id: 'B123' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, url: 'wss://socket.slack.test/link/?app_id=A777' })))
    vi.stubGlobal('fetch', fetchMock)

    const { testSlackCredentials } = await import('../integration')

    await expect(testSlackCredentials({ appToken: 'xapp-1-token', botToken: 'xoxb-1' })).resolves.toMatchObject({
      appId: 'A777',
      socketUrlAvailable: true,
    })
  })

  it('returns a null app id when Slack provides no parseable app identifier', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot_id: 'B123' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, url: 'not a url' })))
    vi.stubGlobal('fetch', fetchMock)

    const { testSlackCredentials } = await import('../integration')

    await expect(testSlackCredentials({ appToken: 'xapp-1-token', botToken: 'xoxb-1' })).resolves.toMatchObject({
      appId: null,
      socketUrlAvailable: true,
    })
  })

  it('returns socketUrlAvailable=false when Slack omits the socket URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot_id: 'B123' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, bot: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)

    const { testSlackCredentials } = await import('../integration')

    await expect(testSlackCredentials({ appToken: 'xapp-1-token', botToken: 'xoxb-1' })).resolves.toMatchObject({
      appId: null,
      socketUrlAvailable: false,
    })
  })

  it('rejects Slack credentials when auth.test omits the bot id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }))))

    const { testSlackCredentials } = await import('../integration')

    await expect(testSlackCredentials({ appToken: 'xapp-1-A123-token', botToken: 'xoxb-1' })).rejects.toThrow(
      'slack_bot_id_missing',
    )
  })

  it('uses Slack error payloads when API calls fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }))))

    const { testSlackCredentials } = await import('../integration')

    await expect(testSlackCredentials({ appToken: 'xapp-1-A123-token', botToken: 'xoxb-1' })).rejects.toThrow(
      'invalid_auth',
    )
  })

  it('uses a method-specific error when Slack returns invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('not json', { status: 502 })))

    const { testSlackCredentials } = await import('../integration')

    await expect(testSlackCredentials({ appToken: 'xapp-1-A123-token', botToken: 'xoxb-1' })).rejects.toThrow(
      'slack_auth_test_failed',
    )
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

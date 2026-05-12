import { afterEach, describe, expect, it, vi } from 'vitest'

describe('Slack Web API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts JSON requests and strips undefined fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, value: 1 })))
    vi.stubGlobal('fetch', fetchMock)

    const { callSlackApi } = await import('../web-api')
    const result = await callSlackApi('chat.postMessage', 'xoxb-token', {
      body: { channel: 'C123', text: 'Hello', thread_ts: undefined },
      contentType: 'json',
    })

    expect(result).toEqual({ ok: true, value: 1 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        body: JSON.stringify({ channel: 'C123', text: 'Hello' }),
        headers: expect.objectContaining({
          Authorization: 'Bearer xoxb-token',
          'Content-Type': 'application/json; charset=utf-8',
        }),
        method: 'POST',
      }),
    )
  })

  it('uses form encoding by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)

    const { callSlackApi } = await import('../web-api')
    await callSlackApi('bots.info', 'xoxb-token', { body: { bot: 'B123' } })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/bots.info',
      expect.objectContaining({
        body: 'bot=B123',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    )
  })

  it('throws Slack errors and method-specific fallbacks', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'invalid_auth' })))
      .mockResolvedValueOnce(new Response('not json', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)

    const { callSlackApi } = await import('../web-api')
    await expect(callSlackApi('auth.test', 'bad-token')).rejects.toThrow('invalid_auth')
    await expect(callSlackApi('auth.test', 'bad-token')).rejects.toThrow('slack_auth_test_failed')
  })
})

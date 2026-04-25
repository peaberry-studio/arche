import { beforeEach, describe, expect, it, vi } from 'vitest'

import { testConnectorConnection } from '@/lib/connectors/test-connection'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('testConnectorConnection for Google Workspace', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('returns pending OAuth message when token is missing', async () => {
    const result = await testConnectorConnection('google_gmail', {
      authType: 'oauth',
    })

    expect(result).toEqual({
      ok: false,
      tested: false,
      message: 'Complete OAuth from the dashboard before testing this connector.',
    })
  })

  it('returns auth failure on 401 for Gmail', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 401,
      ok: false,
    })

    const result = await testConnectorConnection('google_gmail', {
      authType: 'oauth',
      oauth: {
        provider: 'google_gmail',
        accessToken: 'token',
        clientId: 'client',
      },
    })

    expect(result).toEqual({
      ok: false,
      tested: true,
      message: 'Gmail MCP authentication failed (401). Reconnect OAuth and retry.',
    })
  })

  it('returns success for Google Drive when fetch succeeds', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
    })

    const result = await testConnectorConnection('google_drive', {
      authType: 'oauth',
      oauth: {
        provider: 'google_drive',
        accessToken: 'token',
        clientId: 'client',
      },
    })

    expect(result).toEqual({
      ok: true,
      tested: true,
      message: 'Google Drive MCP connection verified.',
    })
  })

  it('returns success for Google Calendar', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
    })

    const result = await testConnectorConnection('google_calendar', {
      authType: 'oauth',
      oauth: {
        provider: 'google_calendar',
        accessToken: 'token',
        clientId: 'client',
      },
    })

    expect(result.ok).toBe(true)
    expect(result.message).toBe('Google Calendar MCP connection verified.')
  })

  it('returns success for Google Chat', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
    })

    const result = await testConnectorConnection('google_chat', {
      authType: 'oauth',
      oauth: {
        provider: 'google_chat',
        accessToken: 'token',
        clientId: 'client',
      },
    })

    expect(result.ok).toBe(true)
    expect(result.message).toBe('Google Chat MCP connection verified.')
  })

  it('returns success for People API', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
    })

    const result = await testConnectorConnection('google_people', {
      authType: 'oauth',
      oauth: {
        provider: 'google_people',
        accessToken: 'token',
        clientId: 'client',
      },
    })

    expect(result.ok).toBe(true)
    expect(result.message).toBe('People API MCP connection verified.')
  })
})

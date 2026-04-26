import { afterEach, describe, expect, it } from 'vitest'

import {
  getGoogleOAuthClientCredentials,
  getGoogleWorkspaceMcpServerUrl,
  GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT,
  GOOGLE_OAUTH_TOKEN_ENDPOINT,
} from '@/lib/connectors/google-workspace'
import {
  googleCalendarStrategy,
  googleChatStrategy,
  googleDriveStrategy,
  googleGmailStrategy,
  googlePeopleStrategy,
} from '@/lib/connectors/oauth-provider-strategies/google-workspace'

const originalClientId = process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
const originalClientSecret = process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET
const originalGmailUrl = process.env.ARCHE_CONNECTOR_GOOGLE_GMAIL_MCP_URL
const originalDriveUrl = process.env.ARCHE_CONNECTOR_GOOGLE_DRIVE_MCP_URL
const originalCalendarUrl = process.env.ARCHE_CONNECTOR_GOOGLE_CALENDAR_MCP_URL
const originalChatUrl = process.env.ARCHE_CONNECTOR_GOOGLE_CHAT_MCP_URL
const originalPeopleUrl = process.env.ARCHE_CONNECTOR_GOOGLE_PEOPLE_MCP_URL

describe('google workspace oauth strategies', () => {
  afterEach(() => {
    if (originalClientId === undefined) delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
    else process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = originalClientId

    if (originalClientSecret === undefined) delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET
    else process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = originalClientSecret

    if (originalGmailUrl === undefined) delete process.env.ARCHE_CONNECTOR_GOOGLE_GMAIL_MCP_URL
    else process.env.ARCHE_CONNECTOR_GOOGLE_GMAIL_MCP_URL = originalGmailUrl

    if (originalDriveUrl === undefined) delete process.env.ARCHE_CONNECTOR_GOOGLE_DRIVE_MCP_URL
    else process.env.ARCHE_CONNECTOR_GOOGLE_DRIVE_MCP_URL = originalDriveUrl

    if (originalCalendarUrl === undefined) delete process.env.ARCHE_CONNECTOR_GOOGLE_CALENDAR_MCP_URL
    else process.env.ARCHE_CONNECTOR_GOOGLE_CALENDAR_MCP_URL = originalCalendarUrl

    if (originalChatUrl === undefined) delete process.env.ARCHE_CONNECTOR_GOOGLE_CHAT_MCP_URL
    else process.env.ARCHE_CONNECTOR_GOOGLE_CHAT_MCP_URL = originalChatUrl

    if (originalPeopleUrl === undefined) delete process.env.ARCHE_CONNECTOR_GOOGLE_PEOPLE_MCP_URL
    else process.env.ARCHE_CONNECTOR_GOOGLE_PEOPLE_MCP_URL = originalPeopleUrl
  })

  it.each([
    ['google_gmail', googleGmailStrategy, 'https://gmailmcp.googleapis.com/mcp/v1'],
    ['google_drive', googleDriveStrategy, 'https://drivemcp.googleapis.com/mcp/v1'],
    ['google_calendar', googleCalendarStrategy, 'https://calendarmcp.googleapis.com/mcp/v1'],
    ['google_chat', googleChatStrategy, 'https://chatmcp.googleapis.com/mcp/v1'],
    ['google_people', googlePeopleStrategy, 'https://people.googleapis.com/mcp/v1'],
  ] as const)('%s strategy returns official MCP URL', async (_type, strategy, expectedUrl) => {
    const url = await strategy.getMcpServerUrl()
    expect(url).toBe(expectedUrl)
  })

  it.each([
    ['google_gmail', googleGmailStrategy],
    ['google_drive', googleDriveStrategy],
    ['google_calendar', googleCalendarStrategy],
    ['google_chat', googleChatStrategy],
    ['google_people', googlePeopleStrategy],
  ] as const)('%s strategy prefers static client registration', (_type, strategy) => {
    expect(strategy.preferStaticClientRegistration()).toBe(true)
  })

  it.each([
    ['google_gmail', googleGmailStrategy],
    ['google_drive', googleDriveStrategy],
    ['google_calendar', googleCalendarStrategy],
    ['google_chat', googleChatStrategy],
    ['google_people', googlePeopleStrategy],
  ] as const)('%s strategy returns null when env credentials are missing', (_type, strategy) => {
    delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
    delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET
    expect(strategy.getStaticClientRegistration()).toBeNull()
  })

  it.each([
    ['google_gmail', googleGmailStrategy],
    ['google_drive', googleDriveStrategy],
    ['google_calendar', googleCalendarStrategy],
    ['google_chat', googleChatStrategy],
    ['google_people', googlePeopleStrategy],
  ] as const)('%s strategy returns credentials when env is set', (_type, strategy) => {
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = 'google-client-id'
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = 'google-client-secret'
    expect(strategy.getStaticClientRegistration()).toEqual({
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
    })
  })

  it.each([
    ['google_gmail', googleGmailStrategy],
    ['google_drive', googleDriveStrategy],
    ['google_calendar', googleCalendarStrategy],
    ['google_chat', googleChatStrategy],
    ['google_people', googlePeopleStrategy],
  ] as const)('%s strategy returns Google metadata overrides', async (_type, strategy) => {
    const overrides = await strategy.getMetadataOverrides()
    expect(overrides).toEqual({
      authorizationEndpoint: GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: GOOGLE_OAUTH_TOKEN_ENDPOINT,
    })
  })

  it.each([
    ['google_gmail', googleGmailStrategy],
    ['google_drive', googleDriveStrategy],
    ['google_calendar', googleCalendarStrategy],
    ['google_chat', googleChatStrategy],
    ['google_people', googlePeopleStrategy],
  ] as const)('%s strategy decorates authorize URL with offline access', (_type, strategy) => {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    strategy.decorateAuthorizeUrl(url)
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  it.each([
    ['google_gmail', 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose'],
    ['google_drive', 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file'],
    ['google_calendar', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events.readonly'],
    ['google_chat', 'https://www.googleapis.com/auth/chat.spaces.readonly https://www.googleapis.com/auth/chat.memberships.readonly https://www.googleapis.com/auth/chat.messages.readonly https://www.googleapis.com/auth/chat.users.readstate.readonly'],
    ['google_people', 'https://www.googleapis.com/auth/directory.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/contacts.readonly'],
  ] as const)('%s strategy returns correct default scope', (type, expectedScope) => {
    const strategy = {
      google_gmail: googleGmailStrategy,
      google_drive: googleDriveStrategy,
      google_calendar: googleCalendarStrategy,
      google_chat: googleChatStrategy,
      google_people: googlePeopleStrategy,
    }[type]
    expect(strategy.getScope()).toBe(expectedScope)
  })

  it('respects env overrides for MCP URLs', async () => {
    process.env.ARCHE_CONNECTOR_GOOGLE_GMAIL_MCP_URL = 'https://gmail.override.com/mcp'
    process.env.ARCHE_CONNECTOR_GOOGLE_DRIVE_MCP_URL = 'https://drive.override.com/mcp'

    expect(await googleGmailStrategy.getMcpServerUrl()).toBe('https://gmail.override.com/mcp')
    expect(await googleDriveStrategy.getMcpServerUrl()).toBe('https://drive.override.com/mcp')
  })
})

describe('google workspace helpers', () => {
  afterEach(() => {
    if (originalClientId === undefined) delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
    else process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = originalClientId

    if (originalClientSecret === undefined) delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET
    else process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = originalClientSecret
  })

  it('getGoogleOAuthClientCredentials returns null when env is missing', () => {
    delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
    delete process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET
    expect(getGoogleOAuthClientCredentials()).toBeNull()
  })

  it('getGoogleOAuthClientCredentials returns credentials when env is set', () => {
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID = 'client-id'
    process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET = 'client-secret'
    expect(getGoogleOAuthClientCredentials()).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })
  })

  it('getGoogleWorkspaceMcpServerUrl returns official URL by default', () => {
    expect(getGoogleWorkspaceMcpServerUrl('google_gmail')).toBe('https://gmailmcp.googleapis.com/mcp/v1')
  })

  it('getGoogleWorkspaceMcpServerUrl respects env override', () => {
    process.env.ARCHE_CONNECTOR_GOOGLE_GMAIL_MCP_URL = 'https://override.com/mcp'
    expect(getGoogleWorkspaceMcpServerUrl('google_gmail')).toBe('https://override.com/mcp')
  })
})

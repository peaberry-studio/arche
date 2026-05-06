import { afterEach, describe, expect, it } from 'vitest'

import { getConnectorMcpServerUrl } from '@/lib/connectors/mcp/server-url'

const originalLinearUrl = process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL
const originalNotionUrl = process.env.ARCHE_CONNECTOR_NOTION_MCP_URL
const originalGoogleGmailUrl = process.env.ARCHE_CONNECTOR_GOOGLE_GMAIL_MCP_URL
const originalGoogleDriveUrl = process.env.ARCHE_CONNECTOR_GOOGLE_DRIVE_MCP_URL
const originalGoogleCalendarUrl = process.env.ARCHE_CONNECTOR_GOOGLE_CALENDAR_MCP_URL
const originalGoogleChatUrl = process.env.ARCHE_CONNECTOR_GOOGLE_CHAT_MCP_URL
const originalGooglePeopleUrl = process.env.ARCHE_CONNECTOR_GOOGLE_PEOPLE_MCP_URL

describe('getConnectorMcpServerUrl', () => {
  afterEach(() => {
    if (originalLinearUrl === undefined) {
      delete process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL
    } else {
      process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL = originalLinearUrl
    }

    if (originalNotionUrl === undefined) {
      delete process.env.ARCHE_CONNECTOR_NOTION_MCP_URL
    } else {
      process.env.ARCHE_CONNECTOR_NOTION_MCP_URL = originalNotionUrl
    }

    if (originalGoogleGmailUrl === undefined) {
      delete process.env.ARCHE_CONNECTOR_GOOGLE_GMAIL_MCP_URL
    } else {
      process.env.ARCHE_CONNECTOR_GOOGLE_GMAIL_MCP_URL = originalGoogleGmailUrl
    }

    if (originalGoogleDriveUrl === undefined) {
      delete process.env.ARCHE_CONNECTOR_GOOGLE_DRIVE_MCP_URL
    } else {
      process.env.ARCHE_CONNECTOR_GOOGLE_DRIVE_MCP_URL = originalGoogleDriveUrl
    }

    if (originalGoogleCalendarUrl === undefined) {
      delete process.env.ARCHE_CONNECTOR_GOOGLE_CALENDAR_MCP_URL
    } else {
      process.env.ARCHE_CONNECTOR_GOOGLE_CALENDAR_MCP_URL = originalGoogleCalendarUrl
    }

    if (originalGoogleChatUrl === undefined) {
      delete process.env.ARCHE_CONNECTOR_GOOGLE_CHAT_MCP_URL
    } else {
      process.env.ARCHE_CONNECTOR_GOOGLE_CHAT_MCP_URL = originalGoogleChatUrl
    }

    if (originalGooglePeopleUrl === undefined) {
      delete process.env.ARCHE_CONNECTOR_GOOGLE_PEOPLE_MCP_URL
    } else {
      process.env.ARCHE_CONNECTOR_GOOGLE_PEOPLE_MCP_URL = originalGooglePeopleUrl
    }
  })

  it('prefers the OAuth-discovered MCP server URL when present', () => {
    const url = getConnectorMcpServerUrl('linear', {
      authType: 'oauth',
      oauth: {
        provider: 'linear',
        accessToken: 'access-token',
        clientId: 'client-1',
        mcpServerUrl: 'https://gateway.linear.example/mcp',
      },
    })

    expect(url).toBe('https://gateway.linear.example/mcp')
  })

  it('uses the configured official MCP URLs for hosted connectors', () => {
    process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL = 'https://linear.internal/mcp'
    process.env.ARCHE_CONNECTOR_NOTION_MCP_URL = 'https://notion.internal/mcp'

    expect(getConnectorMcpServerUrl('linear', {})).toBe('https://linear.internal/mcp')
    expect(getConnectorMcpServerUrl('notion', {})).toBe('https://notion.internal/mcp')
  })

  it('returns the configured custom endpoint and no URL for embedded connectors', () => {
    expect(getConnectorMcpServerUrl('custom', { endpoint: 'https://custom.example/mcp' })).toBe(
      'https://custom.example/mcp'
    )
    expect(getConnectorMcpServerUrl('zendesk', { subdomain: 'acme' })).toBeNull()
    expect(getConnectorMcpServerUrl('ahrefs', { apiKey: 'key' })).toBeNull()
    expect(getConnectorMcpServerUrl('umami', { baseUrl: 'https://api.umami.is/v1' })).toBeNull()
  })

  it('does not let stored OAuth MCP URLs influence hosted connector URLs except Linear and Notion', () => {
    expect(getConnectorMcpServerUrl('google_gmail', {
      authType: 'oauth',
      oauth: {
        provider: 'google_gmail',
        accessToken: 'token',
        clientId: 'client-1',
        mcpServerUrl: 'https://attacker.example/mcp',
      },
    })).toBe('https://gmailmcp.googleapis.com/mcp/v1')
  })

  it('returns official Google Workspace MCP URLs by default', () => {
    expect(getConnectorMcpServerUrl('google_gmail', {})).toBe('https://gmailmcp.googleapis.com/mcp/v1')
    expect(getConnectorMcpServerUrl('google_drive', {})).toBe('https://drivemcp.googleapis.com/mcp/v1')
    expect(getConnectorMcpServerUrl('google_calendar', {})).toBe('https://calendarmcp.googleapis.com/mcp/v1')
    expect(getConnectorMcpServerUrl('google_chat', {})).toBe('https://chatmcp.googleapis.com/mcp/v1')
    expect(getConnectorMcpServerUrl('google_people', {})).toBe('https://people.googleapis.com/mcp/v1')
  })

  it('respects env overrides for Google Workspace MCP URLs', () => {
    process.env.ARCHE_CONNECTOR_GOOGLE_GMAIL_MCP_URL = 'https://gmail.internal/mcp'
    process.env.ARCHE_CONNECTOR_GOOGLE_DRIVE_MCP_URL = 'https://drive.internal/mcp'
    process.env.ARCHE_CONNECTOR_GOOGLE_CALENDAR_MCP_URL = 'https://calendar.internal/mcp'
    process.env.ARCHE_CONNECTOR_GOOGLE_CHAT_MCP_URL = 'https://chat.internal/mcp'
    process.env.ARCHE_CONNECTOR_GOOGLE_PEOPLE_MCP_URL = 'https://people.internal/mcp'

    expect(getConnectorMcpServerUrl('google_gmail', {})).toBe('https://gmail.internal/mcp')
    expect(getConnectorMcpServerUrl('google_drive', {})).toBe('https://drive.internal/mcp')
    expect(getConnectorMcpServerUrl('google_calendar', {})).toBe('https://calendar.internal/mcp')
    expect(getConnectorMcpServerUrl('google_chat', {})).toBe('https://chat.internal/mcp')
    expect(getConnectorMcpServerUrl('google_people', {})).toBe('https://people.internal/mcp')
  })
})

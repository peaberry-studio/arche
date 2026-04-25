import type { ConnectorType } from '@/lib/connectors/types'

export const GOOGLE_WORKSPACE_CONNECTOR_TYPES = [
  'google_gmail',
  'google_drive',
  'google_calendar',
  'google_chat',
  'google_people',
] as const

export type GoogleWorkspaceConnectorType = (typeof GOOGLE_WORKSPACE_CONNECTOR_TYPES)[number]

export function isGoogleWorkspaceConnectorType(type: ConnectorType): type is GoogleWorkspaceConnectorType {
  return GOOGLE_WORKSPACE_CONNECTOR_TYPES.includes(type as GoogleWorkspaceConnectorType)
}

export const GOOGLE_WORKSPACE_PRODUCT_METADATA: Record<
  GoogleWorkspaceConnectorType,
  {
    label: string
    defaultName: string
    mcpServerUrl: string
    scopes: string[]
    envMcpUrlName: string
  }
> = {
  google_gmail: {
    label: 'Gmail',
    defaultName: 'Gmail',
    mcpServerUrl: 'https://gmailmcp.googleapis.com/mcp/v1',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ],
    envMcpUrlName: 'ARCHE_CONNECTOR_GOOGLE_GMAIL_MCP_URL',
  },
  google_drive: {
    label: 'Google Drive',
    defaultName: 'Google Drive',
    mcpServerUrl: 'https://drivemcp.googleapis.com/mcp/v1',
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
    envMcpUrlName: 'ARCHE_CONNECTOR_GOOGLE_DRIVE_MCP_URL',
  },
  google_calendar: {
    label: 'Google Calendar',
    defaultName: 'Google Calendar',
    mcpServerUrl: 'https://calendarmcp.googleapis.com/mcp/v1',
    scopes: [
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
      'https://www.googleapis.com/auth/calendar.events.readonly',
    ],
    envMcpUrlName: 'ARCHE_CONNECTOR_GOOGLE_CALENDAR_MCP_URL',
  },
  google_chat: {
    label: 'Google Chat',
    defaultName: 'Google Chat',
    mcpServerUrl: 'https://chatmcp.googleapis.com/mcp/v1',
    scopes: [
      'https://www.googleapis.com/auth/chat.spaces.readonly',
      'https://www.googleapis.com/auth/chat.memberships.readonly',
      'https://www.googleapis.com/auth/chat.messages.readonly',
      'https://www.googleapis.com/auth/chat.users.readstate.readonly',
    ],
    envMcpUrlName: 'ARCHE_CONNECTOR_GOOGLE_CHAT_MCP_URL',
  },
  google_people: {
    label: 'People API',
    defaultName: 'People API',
    mcpServerUrl: 'https://people.googleapis.com/mcp/v1',
    scopes: [
      'https://www.googleapis.com/auth/directory.readonly',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/contacts.readonly',
    ],
    envMcpUrlName: 'ARCHE_CONNECTOR_GOOGLE_PEOPLE_MCP_URL',
  },
}

export const GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export function getGoogleWorkspaceMcpServerUrl(type: GoogleWorkspaceConnectorType): string {
  const meta = GOOGLE_WORKSPACE_PRODUCT_METADATA[type]
  const override = process.env[meta.envMcpUrlName]
  return override && override.trim() ? override.trim() : meta.mcpServerUrl
}

export function getGoogleWorkspaceDefaultScope(type: GoogleWorkspaceConnectorType): string {
  return GOOGLE_WORKSPACE_PRODUCT_METADATA[type].scopes.join(' ')
}

export function getGoogleWorkspaceLabel(type: GoogleWorkspaceConnectorType): string {
  return GOOGLE_WORKSPACE_PRODUCT_METADATA[type].label
}

export function getGoogleWorkspaceDefaultName(type: GoogleWorkspaceConnectorType): string {
  return GOOGLE_WORKSPACE_PRODUCT_METADATA[type].defaultName
}

export function getGoogleOAuthClientCredentials(
  runtimeConfig?: { clientId?: string; clientSecret?: string } | null,
): { clientId: string; clientSecret: string } | null {
  if (runtimeConfig?.clientId && runtimeConfig.clientSecret) {
    return {
      clientId: runtimeConfig.clientId,
      clientSecret: runtimeConfig.clientSecret,
    }
  }

  const clientId = process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_ID
  const clientSecret = process.env.ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET
  if (!clientId || !clientId.trim() || !clientSecret || !clientSecret.trim()) return null
  return {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
  }
}

import type { LinearOAuthActor } from '@/lib/connectors/linear'
import {
  CONNECTOR_TYPES,
  OAUTH_CONNECTOR_TYPES,
  type ConnectorAuthType,
  type ConnectorType,
} from '@/lib/connectors/types'
import { isGoogleWorkspaceConnectorType } from '@/lib/connectors/google-workspace'

export const CONNECTOR_TYPE_OPTIONS: {
  type: ConnectorType
  label: string
  description: string
}[] = [
  {
    type: 'linear',
    label: 'Linear',
    description: 'Official Linear MCP integration.',
  },
  {
    type: 'notion',
    label: 'Notion',
    description: 'Official Notion MCP integration.',
  },
  {
    type: 'zendesk',
    label: 'Zendesk',
    description: 'Zendesk Ticketing API via Arche MCP.',
  },
  {
    type: 'ahrefs',
    label: 'Ahrefs',
    description: 'Ahrefs SEO data via Arche MCP.',
  },
  {
    type: 'umami',
    label: 'Umami',
    description:
      'Website analytics from Umami Cloud or self-hosted Umami.',
  },
  {
    type: 'meta-ads',
    label: 'Meta Ads',
    description: 'Meta Marketing API insights via Arche MCP.',
  },
  {
    type: 'google_gmail',
    label: 'Gmail',
    description: 'Official Google Workspace Gmail MCP integration.',
  },
  {
    type: 'google_drive',
    label: 'Google Drive',
    description: 'Official Google Workspace Drive MCP integration.',
  },
  {
    type: 'google_calendar',
    label: 'Google Calendar',
    description: 'Official Google Workspace Calendar MCP integration.',
  },
  {
    type: 'google_chat',
    label: 'Google Chat',
    description: 'Official Google Workspace Chat MCP integration.',
  },
  {
    type: 'google_people',
    label: 'People API',
    description: 'Official Google Workspace People API MCP integration.',
  },
  {
    type: 'custom',
    label: 'Custom',
    description: 'Any compatible remote MCP endpoint.',
  },
]

export const DEFAULT_TYPE: ConnectorType = CONNECTOR_TYPES[0]
export const DEFAULT_LINEAR_OAUTH_ACTOR: LinearOAuthActor = 'user'

export function buildDefaultName(type: ConnectorType): string {
  switch (type) {
    case 'linear':
      return 'Linear'
    case 'notion':
      return 'Notion'
    case 'zendesk':
      return 'Zendesk'
    case 'ahrefs':
      return 'Ahrefs'
    case 'umami':
      return 'Umami'
    case 'meta-ads':
      return 'Meta Ads'
    case 'google_gmail':
      return 'Gmail'
    case 'google_drive':
      return 'Google Drive'
    case 'google_calendar':
      return 'Google Calendar'
    case 'google_chat':
      return 'Google Chat'
    case 'google_people':
      return 'People API'
    case 'custom':
      return 'Custom Connector'
  }
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  for (const entry of Object.values(value)) {
    if (typeof entry !== 'string') return false
  }
  return true
}

export function hasValidHeaders(headersText: string): boolean {
  if (!headersText.trim()) return true
  try {
    const parsed = JSON.parse(headersText) as unknown
    return isStringRecord(parsed)
  } catch {
    return false
  }
}

export function supportsOAuth(type: ConnectorType): boolean {
  return (OAUTH_CONNECTOR_TYPES as readonly ConnectorType[]).includes(type)
}

export function getDefaultAuthType(type: ConnectorType): ConnectorAuthType {
  return type === 'linear' || type === 'notion' || type === 'meta-ads' || isGoogleWorkspaceConnectorType(type) ? 'oauth' : 'manual'
}

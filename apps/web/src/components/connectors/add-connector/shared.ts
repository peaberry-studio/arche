import type { LinearOAuthActor } from '@/lib/connectors/linear'
import {
  CONNECTOR_TYPES,
  OAUTH_CONNECTOR_TYPES,
  type ConnectorAuthType,
  type ConnectorType,
} from '@/lib/connectors/types'

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
  return type === 'linear' || type === 'notion' ? 'oauth' : 'manual'
}

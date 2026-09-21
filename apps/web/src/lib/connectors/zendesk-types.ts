import type { ConnectorToolPermissionMap } from '@/lib/connectors/tool-permissions'

export const ZENDESK_CONNECTOR_PERMISSION_KEYS = [
  'allowRead',
  'allowCreateTickets',
  'allowUpdateTickets',
  'allowPublicComments',
  'allowInternalComments',
] as const

export type ZendeskConnectorPermissions = {
  allowRead: boolean
  allowCreateTickets: boolean
  allowUpdateTickets: boolean
  allowPublicComments: boolean
  allowInternalComments: boolean
}

export const DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS: ZendeskConnectorPermissions = {
  allowRead: true,
  allowCreateTickets: true,
  allowUpdateTickets: true,
  allowPublicComments: true,
  allowInternalComments: true,
}

export type ZendeskConnectorConfig = {
  subdomain: string
  email: string
  apiToken: string
  permissions: ZendeskConnectorPermissions
  zendeskActionPermissions?: ZendeskActionPermissions
  storedToolPermissions?: ConnectorToolPermissionMap
}

export const ZENDESK_ACTION_PERMISSIONS_CONFIG_KEY = 'zendeskActionPermissions'

export const ZENDESK_ACTION_PERMISSIONS_VERSION = 1 as const

export const ZENDESK_ACTION_KEYS = [
  'search_tickets',
  'get_ticket',
  'list_ticket_comments',
  'create_ticket_public',
  'create_ticket_internal',
  'update_ticket_fields',
  'update_ticket_with_public_comment',
  'update_ticket_with_internal_note',
] as const

export type ZendeskActionName = (typeof ZENDESK_ACTION_KEYS)[number]

export type ZendeskActionPolicy = 'deny' | 'ask' | 'allow'

export type ZendeskActionPermissions = Record<ZendeskActionName, ZendeskActionPolicy>

export const DEFAULT_ZENDESK_ACTION_PERMISSIONS: ZendeskActionPermissions = {
  search_tickets: 'allow',
  get_ticket: 'allow',
  list_ticket_comments: 'allow',
  create_ticket_public: 'allow',
  create_ticket_internal: 'allow',
  update_ticket_fields: 'allow',
  update_ticket_with_public_comment: 'allow',
  update_ticket_with_internal_note: 'allow',
}

export type ZendeskActionPermissionsConfig = {
  version: typeof ZENDESK_ACTION_PERMISSIONS_VERSION
  actions: ZendeskActionPermissions
}

export type ZendeskToolName = ZendeskActionName

export type ZendeskMcpTextContent = {
  type: 'text'
  text: string
}

export type ZendeskMcpToolResult = {
  content: ZendeskMcpTextContent[]
  isError?: boolean
}

export type ZendeskMcpTool = {
  name: ZendeskToolName
  description: string
  inputSchema: Record<string, unknown>
}

export type ZendeskApiResponse =
  | {
      ok: true
      data: unknown
      status: number
      headers: Headers
    }
  | {
      ok: false
      error: string
      message: string
      status: number
      headers?: Headers
      data?: unknown
      retryAfter?: number
    }

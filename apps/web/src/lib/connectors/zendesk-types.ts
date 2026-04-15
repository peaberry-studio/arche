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
}

export type ZendeskToolName =
  | 'search_tickets'
  | 'get_ticket'
  | 'list_ticket_comments'
  | 'create_ticket'
  | 'update_ticket'

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

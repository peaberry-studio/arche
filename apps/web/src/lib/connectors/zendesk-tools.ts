import { ZENDESK_MCP_PROTOCOL_VERSION } from '@/lib/connectors/zendesk-shared'
import { mapTicket, mapTicketComment, requestZendeskJson } from '@/lib/connectors/zendesk-client'
import type {
  ZendeskApiResponse,
  ZendeskConnectorConfig,
  ZendeskConnectorPermissions,
  ZendeskMcpTool,
  ZendeskMcpToolResult,
} from '@/lib/connectors/zendesk-types'
import {
  getBoolean,
  getFiniteNumber,
  getPositiveInteger,
  getString,
  getStringArray,
  hasOwnProperty,
  isRecord,
  isStringArray,
} from '@/lib/connectors/zendesk-values'

const MAX_LIST_LIMIT = 100
const TICKET_STATUSES = ['new', 'open', 'pending', 'hold', 'solved', 'closed'] as const
const TICKET_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
const TICKET_TYPES = ['problem', 'incident', 'question', 'task'] as const

type ZendeskToolPermission = 'read' | 'create' | 'update'

type ZendeskMcpToolDefinition = ZendeskMcpTool & {
  permission: ZendeskToolPermission
}

const ZENDESK_MCP_TOOLS: ZendeskMcpToolDefinition[] = [
  {
    name: 'search_tickets',
    permission: 'read',
    description: 'Search Zendesk tickets using Zendesk search query syntax. The connector automatically scopes queries to tickets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Zendesk search query. Example: status:open assignee:me urgent',
        },
        page: {
          type: 'integer',
          description: '1-based results page. Defaults to 1.',
          minimum: 1,
        },
        perPage: {
          type: 'integer',
          description: 'Number of results per page. Defaults to 25, maximum 100.',
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_ticket',
    permission: 'read',
    description: 'Fetch a single Zendesk ticket by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'integer',
          description: 'Zendesk ticket ID.',
          minimum: 1,
        },
      },
      required: ['ticketId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_ticket_comments',
    permission: 'read',
    description: 'List comments for a Zendesk ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'integer',
          description: 'Zendesk ticket ID.',
          minimum: 1,
        },
      },
      required: ['ticketId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_ticket',
    permission: 'create',
    description: 'Create a Zendesk ticket with an initial comment as the authenticated connector account.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'Ticket subject line.',
        },
        comment: {
          type: 'string',
          description: 'Initial ticket comment body.',
        },
        priority: {
          type: 'string',
          enum: [...TICKET_PRIORITIES],
          description: 'Optional ticket priority.',
        },
        status: {
          type: 'string',
          enum: [...TICKET_STATUSES],
          description: 'Optional ticket status.',
        },
        type: {
          type: 'string',
          enum: [...TICKET_TYPES],
          description: 'Optional ticket type.',
        },
        publicComment: {
          type: 'boolean',
          description: 'Whether the initial comment should be public. Defaults to true.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional ticket tags.',
        },
      },
      required: ['subject', 'comment'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_ticket',
    permission: 'update',
    description: 'Update a Zendesk ticket and optionally add a comment.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'integer',
          description: 'Zendesk ticket ID.',
          minimum: 1,
        },
        subject: {
          type: 'string',
          description: 'Optional new subject.',
        },
        comment: {
          type: 'string',
          description: 'Optional comment body to add while updating the ticket.',
        },
        priority: {
          type: 'string',
          enum: [...TICKET_PRIORITIES],
          description: 'Optional new priority.',
        },
        status: {
          type: 'string',
          enum: [...TICKET_STATUSES],
          description: 'Optional new status.',
        },
        type: {
          type: 'string',
          enum: [...TICKET_TYPES],
          description: 'Optional new ticket type.',
        },
        assigneeId: {
          type: 'integer',
          description: 'Optional assignee user ID.',
          minimum: 1,
        },
        publicComment: {
          type: 'boolean',
          description: 'Whether the new comment should be public. Defaults to true.',
        },
      },
      required: ['ticketId'],
      additionalProperties: false,
    },
  },
]

function toZendeskMcpTool({ name, description, inputSchema }: ZendeskMcpToolDefinition): ZendeskMcpTool {
  return {
    name,
    description,
    inputSchema,
  }
}

function toToolText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function toToolSuccess(value: unknown): ZendeskMcpToolResult {
  return {
    content: [{ type: 'text', text: toToolText(value) }],
  }
}

function toToolError(error: string, message: string, detail?: Record<string, unknown>): ZendeskMcpToolResult {
  return {
    content: [
      {
        type: 'text',
        text: toToolText({
          ok: false,
          error,
          message,
          ...(detail ? detail : {}),
        }),
      },
    ],
    isError: true,
  }
}

function requireObjectArguments(args: unknown): Record<string, unknown> {
  return isRecord(args) ? args : {}
}

function requireStringArg(args: Record<string, unknown>, key: string): string | null {
  return getString(args[key]) ?? null
}

function getOptionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  return getString(args[key])
}

function getOptionalIntegerArg(args: Record<string, unknown>, key: string): number | undefined {
  return getPositiveInteger(args[key])
}

function getOptionalBooleanArg(args: Record<string, unknown>, key: string): boolean | undefined {
  return getBoolean(args[key])
}

function validateEnumArg<T extends readonly string[]>(
  value: string | undefined,
  values: T,
  label: string
): { ok: true; value?: T[number] } | { ok: false; message: string } {
  if (!value) return { ok: true }
  if (values.includes(value as T[number])) {
    return { ok: true, value: value as T[number] }
  }

  return { ok: false, message: `${label} must be one of: ${values.join(', ')}` }
}

function validateCreateOrUpdateEnums(args: Record<string, unknown>): { ok: true } | { ok: false; message: string } {
  const status = validateEnumArg(getOptionalStringArg(args, 'status'), TICKET_STATUSES, 'status')
  if (!status.ok) return status

  const priority = validateEnumArg(getOptionalStringArg(args, 'priority'), TICKET_PRIORITIES, 'priority')
  if (!priority.ok) return priority

  const type = validateEnumArg(getOptionalStringArg(args, 'type'), TICKET_TYPES, 'type')
  if (!type.ok) return type

  return { ok: true }
}

function getZendeskToolDefinition(toolName: string): ZendeskMcpToolDefinition | undefined {
  return ZENDESK_MCP_TOOLS.find((tool) => tool.name === toolName)
}

function isZendeskToolEnabled(
  permissions: ZendeskConnectorPermissions,
  tool: ZendeskMcpToolDefinition
): boolean {
  switch (tool.permission) {
    case 'read':
      return permissions.allowRead
    case 'create':
      return permissions.allowCreateTickets
    case 'update':
      return permissions.allowUpdateTickets
  }
}

function getZendeskToolDisabledMessage(
  permissions: ZendeskConnectorPermissions,
  toolName: string
): string | null {
  const tool = getZendeskToolDefinition(toolName)
  if (!tool) {
    return null
  }

  switch (tool.permission) {
    case 'read':
      return permissions.allowRead ? null : 'Read operations are disabled for this Zendesk connector'
    case 'create':
      return permissions.allowCreateTickets ? null : 'Ticket creation is disabled for this Zendesk connector'
    case 'update':
      return permissions.allowUpdateTickets ? null : 'Ticket updates are disabled for this Zendesk connector'
  }
}

function buildTicketPayload(
  config: ZendeskConnectorConfig,
  args: Record<string, unknown>,
  mode: 'create' | 'update'
) {
  const ticket: Record<string, unknown> = {}

  const subject = getOptionalStringArg(args, 'subject')
  if (subject) ticket.subject = subject

  const status = getOptionalStringArg(args, 'status')
  if (status) ticket.status = status

  const priority = getOptionalStringArg(args, 'priority')
  if (priority) ticket.priority = priority

  const type = getOptionalStringArg(args, 'type')
  if (type) ticket.type = type

  if (hasOwnProperty(args, 'assigneeId') && getOptionalIntegerArg(args, 'assigneeId') === undefined) {
    return { ok: false, error: 'invalid_arguments', message: 'assigneeId must be a positive integer' } as const
  }

  const assigneeId = getOptionalIntegerArg(args, 'assigneeId')
  if (assigneeId) ticket.assignee_id = assigneeId

  if (hasOwnProperty(args, 'tags') && !isStringArray(args.tags)) {
    return { ok: false, error: 'invalid_arguments', message: 'tags must be a string array' } as const
  }

  const tags = getStringArray(args.tags)
  if (mode === 'create' && tags) {
    ticket.tags = tags
  }

  if (hasOwnProperty(args, 'publicComment') && getOptionalBooleanArg(args, 'publicComment') === undefined) {
    return { ok: false, error: 'invalid_arguments', message: 'publicComment must be a boolean' } as const
  }

  const comment = getOptionalStringArg(args, 'comment')
  if (comment) {
    const isPublicComment = getOptionalBooleanArg(args, 'publicComment') ?? true
    if (isPublicComment && !config.permissions.allowPublicComments) {
      return {
        ok: false,
        error: 'operation_not_allowed',
        message: 'Public comments are disabled for this Zendesk connector',
      } as const
    }

    if (!isPublicComment && !config.permissions.allowInternalComments) {
      return {
        ok: false,
        error: 'operation_not_allowed',
        message: 'Internal comments are disabled for this Zendesk connector',
      } as const
    }

    ticket.comment = {
      body: comment,
      public: isPublicComment,
    }
  }

  if (mode === 'create') {
    ticket.requester = { email: config.email }
  }

  return { ok: true, ticket } as const
}

function mapZendeskToolResponse(
  response: ZendeskApiResponse,
  mapData: (data: Record<string, unknown> | null) => unknown
): ZendeskMcpToolResult {
  if (!response.ok) {
    return toToolError(
      response.error,
      response.message,
      response.retryAfter ? { retryAfter: response.retryAfter } : undefined
    )
  }

  return toToolSuccess(mapData(isRecord(response.data) ? response.data : null))
}

type ZendeskRequestInput = Omit<Parameters<typeof requestZendeskJson>[0], 'config'>

async function runZendeskRequest(
  config: ZendeskConnectorConfig,
  request: ZendeskRequestInput,
  mapData: (data: Record<string, unknown> | null) => unknown
): Promise<ZendeskMcpToolResult> {
  const response = await requestZendeskJson({ config, ...request })
  return mapZendeskToolResponse(response, mapData)
}

export function getZendeskMcpProtocolVersion(): string {
  return ZENDESK_MCP_PROTOCOL_VERSION
}

export function getZendeskMcpTools(config: ZendeskConnectorConfig): ZendeskMcpTool[] {
  return ZENDESK_MCP_TOOLS.filter((tool) => isZendeskToolEnabled(config.permissions, tool)).map(toZendeskMcpTool)
}

export async function executeZendeskMcpTool(
  config: ZendeskConnectorConfig,
  toolName: string,
  args: unknown
): Promise<ZendeskMcpToolResult> {
  const toolArgs = requireObjectArguments(args)
  const permissionError = getZendeskToolDisabledMessage(config.permissions, toolName)
  if (permissionError) {
    return toToolError('operation_not_allowed', permissionError)
  }

  try {
    switch (toolName) {
      case 'search_tickets': {
        const query = requireStringArg(toolArgs, 'query')
        if (!query) {
          return toToolError('invalid_arguments', 'query is required')
        }

        if (hasOwnProperty(toolArgs, 'page') && getOptionalIntegerArg(toolArgs, 'page') === undefined) {
          return toToolError('invalid_arguments', 'page must be a positive integer')
        }

        if (hasOwnProperty(toolArgs, 'perPage') && getOptionalIntegerArg(toolArgs, 'perPage') === undefined) {
          return toToolError('invalid_arguments', 'perPage must be a positive integer')
        }

        const page = getOptionalIntegerArg(toolArgs, 'page') ?? 1
        const perPage = Math.min(getOptionalIntegerArg(toolArgs, 'perPage') ?? 25, MAX_LIST_LIMIT)
        const scopedQuery = query.includes('type:ticket') ? query : `type:ticket ${query}`

        return runZendeskRequest(
          config,
          {
            path: '/search.json',
            searchParams: {
              query: scopedQuery,
              page: String(page),
              per_page: String(perPage),
              sort_by: 'updated_at',
              sort_order: 'desc',
            },
          },
          (data) => {
            const results = Array.isArray(data?.results) ? data.results : []
            return {
              ok: true,
              count: getFiniteNumber(data?.count) ?? results.length,
              page,
              perPage,
              tickets: results.map((ticket) => mapTicket(ticket, config.subdomain)),
              nextPage: getString(data?.next_page) ?? null,
              previousPage: getString(data?.previous_page) ?? null,
            }
          }
        )
      }

      case 'get_ticket': {
        const ticketId = getOptionalIntegerArg(toolArgs, 'ticketId')
        if (!ticketId) {
          return toToolError('invalid_arguments', 'ticketId is required and must be a positive integer')
        }

        return runZendeskRequest(config, { path: `/tickets/${ticketId}.json` }, (data) => ({
          ok: true,
          ticket: mapTicket(data?.ticket, config.subdomain),
        }))
      }

      case 'list_ticket_comments': {
        const ticketId = getOptionalIntegerArg(toolArgs, 'ticketId')
        if (!ticketId) {
          return toToolError('invalid_arguments', 'ticketId is required and must be a positive integer')
        }

        return runZendeskRequest(config, { path: `/tickets/${ticketId}/comments.json` }, (data) => {
          const comments = Array.isArray(data?.comments) ? data.comments : []
          return {
            ok: true,
            ticketId,
            count: comments.length,
            comments: comments.map(mapTicketComment),
          }
        })
      }

      case 'create_ticket': {
        const subject = requireStringArg(toolArgs, 'subject')
        const comment = requireStringArg(toolArgs, 'comment')
        if (!subject || !comment) {
          return toToolError('invalid_arguments', 'subject and comment are required')
        }

        const enumValidation = validateCreateOrUpdateEnums(toolArgs)
        if (!enumValidation.ok) {
          return toToolError('invalid_arguments', enumValidation.message)
        }

        const payload = buildTicketPayload(config, toolArgs, 'create')
        if (!payload.ok) {
          return toToolError(payload.error, payload.message)
        }

        return runZendeskRequest(
          config,
          {
            path: '/tickets.json',
            method: 'POST',
            body: { ticket: payload.ticket },
          },
          (data) => ({
            ok: true,
            ticket: mapTicket(data?.ticket, config.subdomain),
          })
        )
      }

      case 'update_ticket': {
        const ticketId = getOptionalIntegerArg(toolArgs, 'ticketId')
        if (!ticketId) {
          return toToolError('invalid_arguments', 'ticketId is required and must be a positive integer')
        }

        const enumValidation = validateCreateOrUpdateEnums(toolArgs)
        if (!enumValidation.ok) {
          return toToolError('invalid_arguments', enumValidation.message)
        }

        const payload = buildTicketPayload(config, toolArgs, 'update')
        if (!payload.ok) {
          return toToolError(payload.error, payload.message)
        }

        if (Object.keys(payload.ticket).length === 0) {
          return toToolError('invalid_arguments', 'At least one ticket field or comment must be provided')
        }

        return runZendeskRequest(
          config,
          {
            path: `/tickets/${ticketId}.json`,
            method: 'PUT',
            body: { ticket: payload.ticket },
          },
          (data) => ({
            ok: true,
            ticket: mapTicket(data?.ticket, config.subdomain),
          })
        )
      }

      default:
        return toToolError('unknown_tool', `Unknown Zendesk tool: ${toolName}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Zendesk tool error'
    return toToolError('zendesk_tool_failed', message)
  }
}

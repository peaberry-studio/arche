import { ZENDESK_MCP_PROTOCOL_VERSION } from '@/lib/connectors/zendesk-shared'
import { mapTicket, mapTicketComment, requestZendeskJson } from '@/lib/connectors/zendesk-client'
import { resolveZendeskActionPermissions } from '@/lib/connectors/zendesk-action-permissions'
import type {
  ZendeskActionName,
  ZendeskApiResponse,
  ZendeskConnectorConfig,
  ZendeskMcpTool,
  ZendeskMcpToolResult,
} from '@/lib/connectors/zendesk-types'
import {
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

type ZendeskMcpToolDefinition = ZendeskMcpTool & {
  action: ZendeskActionName
}

const ZENDESK_MCP_TOOLS: ZendeskMcpToolDefinition[] = [
  {
    name: 'search_tickets',
    action: 'search_tickets',
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
    action: 'get_ticket',
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
    action: 'list_ticket_comments',
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
    name: 'create_ticket_public',
    action: 'create_ticket_public',
    description: 'Create a Zendesk ticket whose initial comment is public and can notify the requester by email.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'Ticket subject line.',
        },
        comment: {
          type: 'string',
          description: 'Initial public ticket comment body.',
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
    name: 'create_ticket_internal',
    action: 'create_ticket_internal',
    description: 'Create a Zendesk ticket whose initial comment is an internal note visible only to Zendesk agents.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'Ticket subject line.',
        },
        comment: {
          type: 'string',
          description: 'Initial internal ticket comment body.',
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
    name: 'update_ticket_fields',
    action: 'update_ticket_fields',
    description: 'Update Zendesk ticket fields (subject, status, priority, type, assignee) without adding a comment.',
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
      },
      required: ['ticketId'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_ticket_with_public_comment',
    action: 'update_ticket_with_public_comment',
    description: 'Update a Zendesk ticket and add a public comment in the same request. The comment can notify the requester by email.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'integer',
          description: 'Zendesk ticket ID.',
          minimum: 1,
        },
        comment: {
          type: 'string',
          description: 'Public comment body to add while updating the ticket.',
        },
        subject: {
          type: 'string',
          description: 'Optional new subject.',
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
      },
      required: ['ticketId', 'comment'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_ticket_with_internal_note',
    action: 'update_ticket_with_internal_note',
    description: 'Update a Zendesk ticket and add an internal note visible only to Zendesk agents in the same request.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'integer',
          description: 'Zendesk ticket ID.',
          minimum: 1,
        },
        comment: {
          type: 'string',
          description: 'Internal note body to add while updating the ticket.',
        },
        subject: {
          type: 'string',
          description: 'Optional new subject.',
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
      },
      required: ['ticketId', 'comment'],
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

function validateTicketFieldEnums(args: Record<string, unknown>): { ok: true } | { ok: false; message: string } {
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

type ZendeskTicketFields = {
  subject?: string
  status?: string
  priority?: string
  type?: string
  assigneeId?: number
}

function buildTicketFieldPayload(args: Record<string, unknown>): ZendeskTicketFields {
  const fields: ZendeskTicketFields = {}

  const subject = getOptionalStringArg(args, 'subject')
  if (subject) fields.subject = subject

  const status = getOptionalStringArg(args, 'status')
  if (status) fields.status = status

  const priority = getOptionalStringArg(args, 'priority')
  if (priority) fields.priority = priority

  const type = getOptionalStringArg(args, 'type')
  if (type) fields.type = type

  const assigneeId = getOptionalIntegerArg(args, 'assigneeId')
  if (assigneeId) fields.assigneeId = assigneeId

  return fields
}

function validateAssigneeIdArg(args: Record<string, unknown>): { ok: true } | { ok: false; message: string } {
  if (hasOwnProperty(args, 'assigneeId') && getOptionalIntegerArg(args, 'assigneeId') === undefined) {
    return { ok: false, message: 'assigneeId must be a positive integer' }
  }

  return { ok: true }
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
  const actions = resolveZendeskActionPermissions(config)
  return ZENDESK_MCP_TOOLS.filter((tool) => actions[tool.action] !== 'deny').map(toZendeskMcpTool)
}

export async function executeZendeskMcpTool(
  config: ZendeskConnectorConfig,
  toolName: string,
  args: unknown
): Promise<ZendeskMcpToolResult> {
  const toolArgs = requireObjectArguments(args)
  const tool = getZendeskToolDefinition(toolName)
  if (!tool) {
    return toToolError('unknown_tool', `Unknown Zendesk tool: ${toolName}`)
  }

  const actions = resolveZendeskActionPermissions(config)
  if (actions[tool.action] === 'deny') {
    return toToolError('operation_not_allowed', 'This Zendesk action is denied for this connector')
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

      case 'create_ticket_public':
      case 'create_ticket_internal': {
        const subject = requireStringArg(toolArgs, 'subject')
        const comment = requireStringArg(toolArgs, 'comment')
        if (!subject || !comment) {
          return toToolError('invalid_arguments', 'subject and comment are required')
        }

        const enumValidation = validateTicketFieldEnums(toolArgs)
        if (!enumValidation.ok) {
          return toToolError('invalid_arguments', enumValidation.message)
        }

        if (hasOwnProperty(toolArgs, 'tags') && !isStringArray(toolArgs.tags)) {
          return toToolError('invalid_arguments', 'tags must be a string array')
        }

        const isPublic = toolName === 'create_ticket_public'
        const ticket: Record<string, unknown> = {
          subject,
          comment: {
            body: comment,
            public: isPublic,
          },
          requester: { email: config.email },
        }
        Object.assign(ticket, buildTicketFieldPayload(toolArgs))

        const tags = getStringArray(toolArgs.tags)
        if (tags) {
          ticket.tags = tags
        }

        return runZendeskRequest(
          config,
          {
            path: '/tickets.json',
            method: 'POST',
            body: { ticket },
          },
          (data) => ({
            ok: true,
            ticket: mapTicket(data?.ticket, config.subdomain),
          })
        )
      }

      case 'update_ticket_fields': {
        const ticketId = getOptionalIntegerArg(toolArgs, 'ticketId')
        if (!ticketId) {
          return toToolError('invalid_arguments', 'ticketId is required and must be a positive integer')
        }

        if (hasOwnProperty(toolArgs, 'comment')) {
          return toToolError('invalid_arguments', 'comment is not supported by update_ticket_fields; use update_ticket_with_public_comment or update_ticket_with_internal_note')
        }

        if (hasOwnProperty(toolArgs, 'publicComment')) {
          return toToolError('invalid_arguments', 'publicComment is not supported by update_ticket_fields')
        }

        const enumValidation = validateTicketFieldEnums(toolArgs)
        if (!enumValidation.ok) {
          return toToolError('invalid_arguments', enumValidation.message)
        }

        const assigneeValidation = validateAssigneeIdArg(toolArgs)
        if (!assigneeValidation.ok) {
          return toToolError('invalid_arguments', assigneeValidation.message)
        }

        const fields = buildTicketFieldPayload(toolArgs)
        if (Object.keys(fields).length === 0) {
          return toToolError('invalid_arguments', 'At least one ticket field must be provided')
        }

        return runZendeskRequest(
          config,
          {
            path: `/tickets/${ticketId}.json`,
            method: 'PUT',
            body: { ticket: fields },
          },
          (data) => ({
            ok: true,
            ticket: mapTicket(data?.ticket, config.subdomain),
          })
        )
      }

      case 'update_ticket_with_public_comment':
      case 'update_ticket_with_internal_note': {
        const ticketId = getOptionalIntegerArg(toolArgs, 'ticketId')
        const comment = requireStringArg(toolArgs, 'comment')
        if (!ticketId) {
          return toToolError('invalid_arguments', 'ticketId is required and must be a positive integer')
        }
        if (!comment) {
          return toToolError('invalid_arguments', 'comment is required')
        }

        const enumValidation = validateTicketFieldEnums(toolArgs)
        if (!enumValidation.ok) {
          return toToolError('invalid_arguments', enumValidation.message)
        }

        const assigneeValidation = validateAssigneeIdArg(toolArgs)
        if (!assigneeValidation.ok) {
          return toToolError('invalid_arguments', assigneeValidation.message)
        }

        const isPublic = toolName === 'update_ticket_with_public_comment'
        const ticket: Record<string, unknown> = {
          comment: {
            body: comment,
            public: isPublic,
          },
          ...buildTicketFieldPayload(toolArgs),
        }

        return runZendeskRequest(
          config,
          {
            path: `/tickets/${ticketId}.json`,
            method: 'PUT',
            body: { ticket },
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

type ZendeskConnectorConfig = {
  subdomain: string
  email: string
  apiToken: string
}

type ConnectorConfigValidation =
  | { valid: true }
  | { valid: false; missing?: string[]; message?: string }

type ZendeskToolName =
  | 'search_tickets'
  | 'get_ticket'
  | 'list_ticket_comments'
  | 'create_ticket'
  | 'update_ticket'

type ZendeskMcpTextContent = {
  type: 'text'
  text: string
}

type ZendeskMcpToolResult = {
  content: ZendeskMcpTextContent[]
  isError?: boolean
}

type ZendeskMcpTool = {
  name: ZendeskToolName
  description: string
  inputSchema: Record<string, unknown>
}

type ZendeskApiResponse =
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

const ZENDESK_API_BASE_PATH = '/api/v2'
const ZENDESK_TIMEOUT_MS = 15_000
const MAX_LIST_LIMIT = 100
const MCP_PROTOCOL_VERSION = '2025-03-26'
const TICKET_STATUSES = ['new', 'open', 'pending', 'hold', 'solved', 'closed'] as const
const TICKET_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
const TICKET_TYPES = ['problem', 'incident', 'question', 'task'] as const
const ZENDESK_MCP_TOOLS: ZendeskMcpTool[] = [
  {
    name: 'search_tickets',
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
    description: 'Create a Zendesk ticket with an initial comment.',
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
        requesterEmail: {
          type: 'string',
          description: 'Optional requester email address.',
        },
        requesterName: {
          type: 'string',
          description: 'Optional requester name. Requires requesterEmail.',
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

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getPositiveInteger(value: unknown): number | undefined {
  const number = getFiniteNumber(value)
  if (number === undefined || !Number.isInteger(number) || number <= 0) {
    return undefined
  }

  return number
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const strings = value
    .map((entry) => getString(entry))
    .filter((entry): entry is string => Boolean(entry))

  return strings.length > 0 ? strings : undefined
}

function normalizeZendeskSubdomain(input: string): string {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return ''

  const withoutProtocol = trimmed.replace(/^https?:\/\//, '')
  const host = withoutProtocol.split(/[/?#]/, 1)[0] ?? withoutProtocol
  return host.replace(/\.zendesk\.com$/, '')
}

function isValidZendeskSubdomain(subdomain: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)
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

function parseRetryAfter(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after')
  if (!retryAfter) return undefined

  const seconds = Number(retryAfter)
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : undefined
}

function extractZendeskErrorDetail(payload: unknown): string | undefined {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim()
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }

  const record = payload as Record<string, unknown>
  const directKeys = ['description', 'details', 'message', 'error', 'title']
  for (const key of directKeys) {
    const value = getString(record[key])
    if (value) return value
  }

  const errors = record.errors
  if (Array.isArray(errors)) {
    const value = errors.map((entry) => getString(entry)).filter((entry): entry is string => Boolean(entry)).join('; ')
    if (value) return value
  }

  return undefined
}

function mapTicket(ticket: unknown, subdomain: string): Record<string, unknown> {
  const record = ticket && typeof ticket === 'object' && !Array.isArray(ticket)
    ? ticket as Record<string, unknown>
    : {}

  const id = getPositiveInteger(record.id)
  return {
    id,
    subject: getString(record.subject) ?? null,
    status: getString(record.status) ?? null,
    priority: getString(record.priority) ?? null,
    type: getString(record.type) ?? null,
    requesterId: getPositiveInteger(record.requester_id) ?? null,
    assigneeId: getPositiveInteger(record.assignee_id) ?? null,
    organizationId: getPositiveInteger(record.organization_id) ?? null,
    createdAt: getString(record.created_at) ?? null,
    updatedAt: getString(record.updated_at) ?? null,
    tags: getStringArray(record.tags) ?? [],
    url: id ? `https://${subdomain}.zendesk.com/agent/tickets/${id}` : null,
  }
}

function mapTicketComment(comment: unknown): Record<string, unknown> {
  const record = comment && typeof comment === 'object' && !Array.isArray(comment)
    ? comment as Record<string, unknown>
    : {}

  return {
    id: getPositiveInteger(record.id) ?? null,
    authorId: getPositiveInteger(record.author_id) ?? null,
    body: getString(record.body) ?? null,
    public: getBoolean(record.public) ?? null,
    createdAt: getString(record.created_at) ?? null,
    attachments: Array.isArray(record.attachments) ? record.attachments.length : 0,
  }
}

function buildZendeskApiUrl(
  config: ZendeskConnectorConfig,
  path: string,
  searchParams?: Record<string, string>
): URL {
  const url = new URL(`https://${config.subdomain}.zendesk.com${ZENDESK_API_BASE_PATH}${path}`)
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value)
    }
  }
  return url
}

function buildZendeskAuthorizationHeader(config: ZendeskConnectorConfig): string {
  const raw = `${config.email}/token:${config.apiToken}`
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
}

async function requestZendeskJson(input: {
  config: ZendeskConnectorConfig
  path: string
  method?: 'GET' | 'POST' | 'PUT'
  searchParams?: Record<string, string>
  body?: unknown
}): Promise<ZendeskApiResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ZENDESK_TIMEOUT_MS)

  try {
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: buildZendeskAuthorizationHeader(input.config),
      'User-Agent': 'Arche Zendesk Connector',
    })

    let body: string | undefined
    if (input.body !== undefined) {
      headers.set('Content-Type', 'application/json')
      body = JSON.stringify(input.body)
    }

    const response = await fetch(buildZendeskApiUrl(input.config, input.path, input.searchParams), {
      method: input.method ?? 'GET',
      headers,
      body,
      cache: 'no-store',
      signal: controller.signal,
    })

    const contentType = response.headers.get('content-type') ?? ''
    let payload: unknown = null
    if (response.status !== 204) {
      if (contentType.includes('application/json')) {
        payload = await response.json().catch(() => null)
      } else {
        const text = await response.text().catch(() => '')
        payload = text || null
      }
    }

    if (!response.ok) {
      const retryAfter = parseRetryAfter(response.headers)
      const detail = extractZendeskErrorDetail(payload)
      return {
        ok: false,
        error: 'zendesk_request_failed',
        message: detail ? `Zendesk request failed (${response.status}): ${detail}` : `Zendesk request failed (${response.status})`,
        status: response.status,
        headers: response.headers,
        data: payload,
        retryAfter,
      }
    }

    return {
      ok: true,
      data: payload,
      status: response.status,
      headers: response.headers,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'
    return {
      ok: false,
      error: 'zendesk_request_failed',
      message: `Zendesk request failed: ${message}`,
      status: 0,
    }
  } finally {
    clearTimeout(timer)
  }
}

function requireObjectArguments(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }

  return {}
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

function buildTicketPayload(args: Record<string, unknown>, mode: 'create' | 'update') {
  const ticket: Record<string, unknown> = {}

  const subject = getOptionalStringArg(args, 'subject')
  if (subject) ticket.subject = subject

  const status = getOptionalStringArg(args, 'status')
  if (status) ticket.status = status

  const priority = getOptionalStringArg(args, 'priority')
  if (priority) ticket.priority = priority

  const type = getOptionalStringArg(args, 'type')
  if (type) ticket.type = type

  const assigneeId = getOptionalIntegerArg(args, 'assigneeId')
  if (assigneeId) ticket.assignee_id = assigneeId

  const tags = getStringArray(args.tags)
  if (mode === 'create' && tags) {
    ticket.tags = tags
  }

  const comment = getOptionalStringArg(args, 'comment')
  if (comment) {
    ticket.comment = {
      body: comment,
      public: getOptionalBooleanArg(args, 'publicComment') ?? true,
    }
  }

  if (mode === 'create') {
    const requesterEmail = getOptionalStringArg(args, 'requesterEmail')
    const requesterName = getOptionalStringArg(args, 'requesterName')
    if (requesterName && !requesterEmail) {
      return { ok: false, message: 'requesterName requires requesterEmail' } as const
    }

    if (requesterEmail) {
      ticket.requester = {
        email: requesterEmail,
        ...(requesterName ? { name: requesterName } : {}),
      }
    }
  }

  return { ok: true, ticket } as const
}

export function validateZendeskConnectorConfig(config: Record<string, unknown>): ConnectorConfigValidation {
  const missing = ['subdomain', 'email', 'apiToken'].filter((key) => !getString(config[key]))
  if (missing.length > 0) {
    return { valid: false, missing }
  }

  const subdomain = normalizeZendeskSubdomain(String(config.subdomain))
  if (!isValidZendeskSubdomain(subdomain)) {
    return {
      valid: false,
      message: 'Subdomain must be a valid Zendesk subdomain or hostname.',
    }
  }

  return { valid: true }
}

export function parseZendeskConnectorConfig(
  config: Record<string, unknown>
): { ok: true; value: ZendeskConnectorConfig } | { ok: false; missing?: string[]; message?: string } {
  const validation = validateZendeskConnectorConfig(config)
  if (!validation.valid) {
    return {
      ok: false,
      missing: validation.missing,
      message: validation.message,
    }
  }

  return {
    ok: true,
    value: {
      subdomain: normalizeZendeskSubdomain(String(config.subdomain)),
      email: String(config.email).trim(),
      apiToken: String(config.apiToken).trim(),
    },
  }
}

export async function testZendeskConnection(config: ZendeskConnectorConfig): Promise<ZendeskApiResponse> {
  return requestZendeskJson({
    config,
    path: '/users/me.json',
  })
}

export function getZendeskMcpProtocolVersion(): string {
  return MCP_PROTOCOL_VERSION
}

export function getZendeskMcpTools(): ZendeskMcpTool[] {
  return ZENDESK_MCP_TOOLS
}

export async function executeZendeskMcpTool(
  config: ZendeskConnectorConfig,
  toolName: string,
  args: unknown
): Promise<ZendeskMcpToolResult> {
  const toolArgs = requireObjectArguments(args)

  try {
    switch (toolName) {
      case 'search_tickets': {
        const query = requireStringArg(toolArgs, 'query')
        if (!query) {
          return toToolError('invalid_arguments', 'query is required')
        }

        const page = getOptionalIntegerArg(toolArgs, 'page') ?? 1
        const perPage = Math.min(getOptionalIntegerArg(toolArgs, 'perPage') ?? 25, MAX_LIST_LIMIT)
        const scopedQuery = query.includes('type:ticket') ? query : `type:ticket ${query}`

        const response = await requestZendeskJson({
          config,
          path: '/search.json',
          searchParams: {
            query: scopedQuery,
            page: String(page),
            per_page: String(perPage),
            sort_by: 'updated_at',
            sort_order: 'desc',
          },
        })

        if (!response.ok) {
          return toToolError(response.error, response.message, response.retryAfter ? { retryAfter: response.retryAfter } : undefined)
        }

        const data = response.data as Record<string, unknown> | null
        const results = Array.isArray(data?.results) ? data.results : []
        return toToolSuccess({
          ok: true,
          count: getFiniteNumber(data?.count) ?? results.length,
          page,
          perPage,
          tickets: results.map((ticket) => mapTicket(ticket, config.subdomain)),
          nextPage: getString(data?.next_page) ?? null,
          previousPage: getString(data?.previous_page) ?? null,
        })
      }

      case 'get_ticket': {
        const ticketId = getOptionalIntegerArg(toolArgs, 'ticketId')
        if (!ticketId) {
          return toToolError('invalid_arguments', 'ticketId is required and must be a positive integer')
        }

        const response = await requestZendeskJson({
          config,
          path: `/tickets/${ticketId}.json`,
        })

        if (!response.ok) {
          return toToolError(response.error, response.message, response.retryAfter ? { retryAfter: response.retryAfter } : undefined)
        }

        const data = response.data as Record<string, unknown> | null
        return toToolSuccess({
          ok: true,
          ticket: mapTicket(data?.ticket, config.subdomain),
        })
      }

      case 'list_ticket_comments': {
        const ticketId = getOptionalIntegerArg(toolArgs, 'ticketId')
        if (!ticketId) {
          return toToolError('invalid_arguments', 'ticketId is required and must be a positive integer')
        }

        const response = await requestZendeskJson({
          config,
          path: `/tickets/${ticketId}/comments.json`,
        })

        if (!response.ok) {
          return toToolError(response.error, response.message, response.retryAfter ? { retryAfter: response.retryAfter } : undefined)
        }

        const data = response.data as Record<string, unknown> | null
        const comments = Array.isArray(data?.comments) ? data.comments : []
        return toToolSuccess({
          ok: true,
          ticketId,
          count: comments.length,
          comments: comments.map(mapTicketComment),
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

        const payload = buildTicketPayload(toolArgs, 'create')
        if (!payload.ok) {
          return toToolError('invalid_arguments', payload.message)
        }

        const response = await requestZendeskJson({
          config,
          path: '/tickets.json',
          method: 'POST',
          body: { ticket: payload.ticket },
        })

        if (!response.ok) {
          return toToolError(response.error, response.message, response.retryAfter ? { retryAfter: response.retryAfter } : undefined)
        }

        const data = response.data as Record<string, unknown> | null
        return toToolSuccess({
          ok: true,
          ticket: mapTicket(data?.ticket, config.subdomain),
        })
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

        const payload = buildTicketPayload(toolArgs, 'update')
        if (!payload.ok) {
          return toToolError('invalid_arguments', payload.message)
        }

        if (Object.keys(payload.ticket).length === 0) {
          return toToolError('invalid_arguments', 'At least one ticket field or comment must be provided')
        }

        const response = await requestZendeskJson({
          config,
          path: `/tickets/${ticketId}.json`,
          method: 'PUT',
          body: { ticket: payload.ticket },
        })

        if (!response.ok) {
          return toToolError(response.error, response.message, response.retryAfter ? { retryAfter: response.retryAfter } : undefined)
        }

        const data = response.data as Record<string, unknown> | null
        return toToolSuccess({
          ok: true,
          ticket: mapTicket(data?.ticket, config.subdomain),
        })
      }

      default:
        return toToolError('unknown_tool', `Unknown Zendesk tool: ${toolName}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Zendesk tool error'
    return toToolError('zendesk_tool_failed', message)
  }
}

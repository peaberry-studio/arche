import { requestUmamiJson } from '@/lib/connectors/umami-client'
import type {
  UmamiConnectorConfig,
  UmamiMcpTool,
  UmamiMcpToolResult,
  UmamiToolName,
} from '@/lib/connectors/umami-types'

const UMAMI_MCP_PROTOCOL_VERSION = '2025-03-26'
const DEFAULT_RANGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_LIST_PAGE_SIZE = 20
const MAX_LIST_PAGE_SIZE = 100
const DEFAULT_METRIC_LIMIT = 100
const MAX_METRIC_LIMIT = 500
const METRIC_TYPES = [
  'path',
  'entry',
  'exit',
  'title',
  'query',
  'referrer',
  'channel',
  'domain',
  'country',
  'region',
  'city',
  'browser',
  'os',
  'device',
  'language',
  'screen',
  'event',
  'hostname',
  'tag',
  'distinctId',
] as const
const TIME_UNITS = ['minute', 'hour', 'day', 'month', 'year'] as const

type MetricsType = (typeof METRIC_TYPES)[number]
type TimeUnit = (typeof TIME_UNITS)[number]
type JsonRecord = Record<string, unknown>

const FILTERS_INPUT_SCHEMA = {
  type: 'object',
  description:
    'Optional Umami filters. Use direct Umami filter keys such as path, referrer, browser, country, event, hostname, utmSource, utmCampaign, or distinctId.',
  additionalProperties: {
    type: 'string',
  },
} as const

const UMAMI_MCP_TOOLS: UmamiMcpTool[] = [
  {
    name: 'list_websites',
    description: 'List websites available to the configured Umami account.',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Optional search text.',
        },
        page: {
          type: 'integer',
          minimum: 1,
          description: '1-based page number. Defaults to 1.',
        },
        pageSize: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_LIST_PAGE_SIZE,
          description: `Results per page. Defaults to ${DEFAULT_LIST_PAGE_SIZE}.`,
        },
        includeTeams: {
          type: 'boolean',
          description: 'Include websites from owned teams when supported by the account.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_website_stats',
    description: 'Get summary traffic metrics for a website over a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        websiteId: {
          type: 'string',
          description: 'Umami website ID.',
        },
        startAt: {
          type: 'string',
          description: 'Optional start time as an ISO date string. Defaults to 30 days ago.',
        },
        endAt: {
          type: 'string',
          description: 'Optional end time as an ISO date string. Defaults to now.',
        },
        compare: {
          type: 'string',
          enum: ['prev', 'yoy'],
          description: 'Optional comparison period.',
        },
        filters: FILTERS_INPUT_SCHEMA,
      },
      required: ['websiteId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_website_pageviews',
    description: 'Get pageview and session series for a website over time.',
    inputSchema: {
      type: 'object',
      properties: {
        websiteId: {
          type: 'string',
          description: 'Umami website ID.',
        },
        startAt: {
          type: 'string',
          description: 'Optional start time as an ISO date string. Defaults to 30 days ago.',
        },
        endAt: {
          type: 'string',
          description: 'Optional end time as an ISO date string. Defaults to now.',
        },
        unit: {
          type: 'string',
          enum: [...TIME_UNITS],
          description: 'Optional aggregation unit.',
        },
        timezone: {
          type: 'string',
          description: 'Optional IANA timezone like Europe/Madrid.',
        },
        compare: {
          type: 'string',
          enum: ['prev', 'yoy'],
          description: 'Optional comparison period.',
        },
        filters: FILTERS_INPUT_SCHEMA,
      },
      required: ['websiteId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_website_metrics',
    description: 'Get ranked metrics such as top pages, referrers, countries, browsers, or events.',
    inputSchema: {
      type: 'object',
      properties: {
        websiteId: {
          type: 'string',
          description: 'Umami website ID.',
        },
        type: {
          type: 'string',
          enum: [...METRIC_TYPES],
          description: 'Metric dimension to rank.',
        },
        startAt: {
          type: 'string',
          description: 'Optional start time as an ISO date string. Defaults to 30 days ago.',
        },
        endAt: {
          type: 'string',
          description: 'Optional end time as an ISO date string. Defaults to now.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_METRIC_LIMIT,
          description: `Maximum rows to return. Defaults to ${DEFAULT_METRIC_LIMIT}.`,
        },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'Rows to skip before returning results.',
        },
        expanded: {
          type: 'boolean',
          description: 'Return expanded metrics including pageviews, visitors, visits, bounces and total time.',
        },
        filters: FILTERS_INPUT_SCHEMA,
      },
      required: ['websiteId', 'type'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_sessions',
    description: 'List website sessions within a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        websiteId: {
          type: 'string',
          description: 'Umami website ID.',
        },
        startAt: {
          type: 'string',
          description: 'Optional start time as an ISO date string. Defaults to 30 days ago.',
        },
        endAt: {
          type: 'string',
          description: 'Optional end time as an ISO date string. Defaults to now.',
        },
        search: {
          type: 'string',
          description: 'Optional search text.',
        },
        page: {
          type: 'integer',
          minimum: 1,
          description: '1-based page number. Defaults to 1.',
        },
        pageSize: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_LIST_PAGE_SIZE,
          description: `Results per page. Defaults to ${DEFAULT_LIST_PAGE_SIZE}.`,
        },
        filters: FILTERS_INPUT_SCHEMA,
      },
      required: ['websiteId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_events',
    description: 'List website events within a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        websiteId: {
          type: 'string',
          description: 'Umami website ID.',
        },
        startAt: {
          type: 'string',
          description: 'Optional start time as an ISO date string. Defaults to 30 days ago.',
        },
        endAt: {
          type: 'string',
          description: 'Optional end time as an ISO date string. Defaults to now.',
        },
        search: {
          type: 'string',
          description: 'Optional search text.',
        },
        page: {
          type: 'integer',
          minimum: 1,
          description: '1-based page number. Defaults to 1.',
        },
        pageSize: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_LIST_PAGE_SIZE,
          description: `Results per page. Defaults to ${DEFAULT_LIST_PAGE_SIZE}.`,
        },
        filters: FILTERS_INPUT_SCHEMA,
      },
      required: ['websiteId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_realtime',
    description: 'Get realtime website activity for the last 30 minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        websiteId: {
          type: 'string',
          description: 'Umami website ID.',
        },
      },
      required: ['websiteId'],
      additionalProperties: false,
    },
  },
]

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function getPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function getNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function requireObjectArguments(args: unknown): JsonRecord {
  return isRecord(args) ? args : {}
}

function toToolText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function toToolSuccess(value: unknown): UmamiMcpToolResult {
  return {
    content: [{ type: 'text', text: toToolText(value) }],
  }
}

function toToolError(error: string, message: string, detail?: Record<string, unknown>): UmamiMcpToolResult {
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

function parseTimestamp(value: unknown, label: string):
  | { ok: true; value: number | undefined }
  | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true, value: undefined }
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { ok: true, value: Math.floor(value) }
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      return { ok: true, value: Math.floor(numeric) }
    }

    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return { ok: true, value: parsed }
    }
  }

  return { ok: false, message: `${label} must be an ISO date string or unix timestamp in milliseconds` }
}

function getDateRange(args: JsonRecord):
  | { ok: true; startAt: number; endAt: number }
  | { ok: false; message: string } {
  const parsedStartAt = parseTimestamp(args.startAt, 'startAt')
  if (!parsedStartAt.ok) return parsedStartAt

  const parsedEndAt = parseTimestamp(args.endAt, 'endAt')
  if (!parsedEndAt.ok) return parsedEndAt

  const endAt = parsedEndAt.value ?? Date.now()
  const startAt = parsedStartAt.value ?? endAt - DEFAULT_RANGE_MS
  if (startAt >= endAt) {
    return { ok: false, message: 'startAt must be earlier than endAt' }
  }

  return { ok: true, startAt, endAt }
}

function getFilters(value: unknown):
  | { ok: true; value: Record<string, string> }
  | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true, value: {} }
  }

  if (!isRecord(value)) {
    return { ok: false, message: 'filters must be an object with string values' }
  }

  const filters: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    const parsed = getString(entry)
    if (!parsed) {
      return { ok: false, message: `filters.${key} must be a non-empty string` }
    }
    filters[key] = parsed
  }

  return { ok: true, value: filters }
}

function appendFilters(searchParams: URLSearchParams, filters: Record<string, string>): void {
  for (const [key, value] of Object.entries(filters)) {
    if (searchParams.has(key)) continue
    searchParams.set(key, value)
  }
}

function getWebsiteId(args: JsonRecord): string | null {
  return getString(args.websiteId) ?? null
}

function getPage(args: JsonRecord):
  | { ok: true; value: number }
  | { ok: false; message: string } {
  if (args.page === undefined) {
    return { ok: true, value: 1 }
  }

  const page = getPositiveInteger(args.page)
  return page
    ? { ok: true, value: page }
    : { ok: false, message: 'page must be a positive integer' }
}

function getPageSize(args: JsonRecord):
  | { ok: true; value: number }
  | { ok: false; message: string } {
  if (args.pageSize === undefined) {
    return { ok: true, value: DEFAULT_LIST_PAGE_SIZE }
  }

  const pageSize = getPositiveInteger(args.pageSize)
  if (!pageSize) {
    return { ok: false, message: 'pageSize must be a positive integer' }
  }
  if (pageSize > MAX_LIST_PAGE_SIZE) {
    return { ok: false, message: `pageSize must be less than or equal to ${MAX_LIST_PAGE_SIZE}` }
  }

  return { ok: true, value: pageSize }
}

function getMetricLimit(args: JsonRecord):
  | { ok: true; value: number }
  | { ok: false; message: string } {
  if (args.limit === undefined) {
    return { ok: true, value: DEFAULT_METRIC_LIMIT }
  }

  const limit = getPositiveInteger(args.limit)
  if (!limit) {
    return { ok: false, message: 'limit must be a positive integer' }
  }
  if (limit > MAX_METRIC_LIMIT) {
    return { ok: false, message: `limit must be less than or equal to ${MAX_METRIC_LIMIT}` }
  }

  return { ok: true, value: limit }
}

function getOffset(args: JsonRecord):
  | { ok: true; value: number }
  | { ok: false; message: string } {
  if (args.offset === undefined) {
    return { ok: true, value: 0 }
  }

  const offset = getNonNegativeInteger(args.offset)
  return offset !== undefined
    ? { ok: true, value: offset }
    : { ok: false, message: 'offset must be a non-negative integer' }
}

function getMetricType(value: unknown): MetricsType | null {
  return typeof value === 'string' && METRIC_TYPES.includes(value as MetricsType)
    ? (value as MetricsType)
    : null
}

function getTimeUnit(value: unknown): TimeUnit | undefined {
  return typeof value === 'string' && TIME_UNITS.includes(value as TimeUnit)
    ? (value as TimeUnit)
    : undefined
}

function buildResponseErrorDetail(response: {
  status: number
  retryAfter?: number
  data?: unknown
}): Record<string, unknown> {
  return {
    status: response.status,
    ...(response.retryAfter ? { retryAfter: response.retryAfter } : {}),
    ...(response.data !== undefined ? { detail: response.data } : {}),
  }
}

export function getUmamiMcpProtocolVersion(): string {
  return UMAMI_MCP_PROTOCOL_VERSION
}

export function getUmamiMcpTools(): UmamiMcpTool[] {
  return UMAMI_MCP_TOOLS.map((tool) => ({ ...tool }))
}

export async function executeUmamiMcpTool(
  config: UmamiConnectorConfig,
  toolName: string,
  args: unknown
): Promise<UmamiMcpToolResult> {
  const parsedArgs = requireObjectArguments(args)

  switch (toolName as UmamiToolName) {
    case 'list_websites': {
      const page = getPage(parsedArgs)
      if (!page.ok) return toToolError('invalid_arguments', page.message)

      const pageSize = getPageSize(parsedArgs)
      if (!pageSize.ok) return toToolError('invalid_arguments', pageSize.message)

      const searchParams = new URLSearchParams({
        page: String(page.value),
        pageSize: String(pageSize.value),
      })

      const search = getString(parsedArgs.search)
      if (search) searchParams.set('search', search)

      const includeTeams = getBoolean(parsedArgs.includeTeams)
      if (includeTeams !== undefined) {
        searchParams.set('includeTeams', includeTeams ? 'true' : 'false')
      }

      const response = await requestUmamiJson({ config, path: 'websites', searchParams })
      if (!response.ok) {
        return toToolError(response.error, response.message, buildResponseErrorDetail(response))
      }

      return toToolSuccess({ ok: true, websites: response.data })
    }

    case 'get_website_stats': {
      const websiteId = getWebsiteId(parsedArgs)
      if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')

      const range = getDateRange(parsedArgs)
      if (!range.ok) return toToolError('invalid_arguments', range.message)

      const filters = getFilters(parsedArgs.filters)
      if (!filters.ok) return toToolError('invalid_arguments', filters.message)

      const searchParams = new URLSearchParams({
        startAt: String(range.startAt),
        endAt: String(range.endAt),
      })

      const compare = getString(parsedArgs.compare)
      if (compare) searchParams.set('compare', compare)
      appendFilters(searchParams, filters.value)

      const response = await requestUmamiJson({
        config,
        path: `websites/${websiteId}/stats`,
        searchParams,
      })
      if (!response.ok) {
        return toToolError(response.error, response.message, buildResponseErrorDetail(response))
      }

      return toToolSuccess({
        ok: true,
        websiteId,
        startAt: new Date(range.startAt).toISOString(),
        endAt: new Date(range.endAt).toISOString(),
        stats: response.data,
      })
    }

    case 'get_website_pageviews': {
      const websiteId = getWebsiteId(parsedArgs)
      if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')

      const range = getDateRange(parsedArgs)
      if (!range.ok) return toToolError('invalid_arguments', range.message)

      const filters = getFilters(parsedArgs.filters)
      if (!filters.ok) return toToolError('invalid_arguments', filters.message)

      const searchParams = new URLSearchParams({
        startAt: String(range.startAt),
        endAt: String(range.endAt),
      })

      const unit = getTimeUnit(parsedArgs.unit)
      if (parsedArgs.unit !== undefined && !unit) {
        return toToolError('invalid_arguments', `unit must be one of: ${TIME_UNITS.join(', ')}`)
      }
      if (unit) searchParams.set('unit', unit)

      const timezone = getString(parsedArgs.timezone)
      if (timezone) searchParams.set('timezone', timezone)

      const compare = getString(parsedArgs.compare)
      if (compare) searchParams.set('compare', compare)
      appendFilters(searchParams, filters.value)

      const response = await requestUmamiJson({
        config,
        path: `websites/${websiteId}/pageviews`,
        searchParams,
      })
      if (!response.ok) {
        return toToolError(response.error, response.message, buildResponseErrorDetail(response))
      }

      return toToolSuccess({
        ok: true,
        websiteId,
        startAt: new Date(range.startAt).toISOString(),
        endAt: new Date(range.endAt).toISOString(),
        pageviews: response.data,
      })
    }

    case 'get_website_metrics': {
      const websiteId = getWebsiteId(parsedArgs)
      if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')

      const type = getMetricType(parsedArgs.type)
      if (!type) {
        return toToolError('invalid_arguments', `type must be one of: ${METRIC_TYPES.join(', ')}`)
      }

      const range = getDateRange(parsedArgs)
      if (!range.ok) return toToolError('invalid_arguments', range.message)

      const filters = getFilters(parsedArgs.filters)
      if (!filters.ok) return toToolError('invalid_arguments', filters.message)

      const limit = getMetricLimit(parsedArgs)
      if (!limit.ok) return toToolError('invalid_arguments', limit.message)

      const offset = getOffset(parsedArgs)
      if (!offset.ok) return toToolError('invalid_arguments', offset.message)

      const expanded = getBoolean(parsedArgs.expanded) ?? false
      const searchParams = new URLSearchParams({
        startAt: String(range.startAt),
        endAt: String(range.endAt),
        type,
        limit: String(limit.value),
        offset: String(offset.value),
      })
      appendFilters(searchParams, filters.value)

      const response = await requestUmamiJson({
        config,
        path: `websites/${websiteId}/metrics${expanded ? '/expanded' : ''}`,
        searchParams,
      })
      if (!response.ok) {
        return toToolError(response.error, response.message, buildResponseErrorDetail(response))
      }

      return toToolSuccess({
        ok: true,
        websiteId,
        type,
        expanded,
        startAt: new Date(range.startAt).toISOString(),
        endAt: new Date(range.endAt).toISOString(),
        metrics: response.data,
      })
    }

    case 'list_sessions': {
      const websiteId = getWebsiteId(parsedArgs)
      if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')

      const range = getDateRange(parsedArgs)
      if (!range.ok) return toToolError('invalid_arguments', range.message)

      const filters = getFilters(parsedArgs.filters)
      if (!filters.ok) return toToolError('invalid_arguments', filters.message)

      const page = getPage(parsedArgs)
      if (!page.ok) return toToolError('invalid_arguments', page.message)

      const pageSize = getPageSize(parsedArgs)
      if (!pageSize.ok) return toToolError('invalid_arguments', pageSize.message)

      const searchParams = new URLSearchParams({
        startAt: String(range.startAt),
        endAt: String(range.endAt),
        page: String(page.value),
        pageSize: String(pageSize.value),
      })

      const search = getString(parsedArgs.search)
      if (search) searchParams.set('search', search)
      appendFilters(searchParams, filters.value)

      const response = await requestUmamiJson({
        config,
        path: `websites/${websiteId}/sessions`,
        searchParams,
      })
      if (!response.ok) {
        return toToolError(response.error, response.message, buildResponseErrorDetail(response))
      }

      return toToolSuccess({
        ok: true,
        websiteId,
        startAt: new Date(range.startAt).toISOString(),
        endAt: new Date(range.endAt).toISOString(),
        sessions: response.data,
      })
    }

    case 'list_events': {
      const websiteId = getWebsiteId(parsedArgs)
      if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')

      const range = getDateRange(parsedArgs)
      if (!range.ok) return toToolError('invalid_arguments', range.message)

      const filters = getFilters(parsedArgs.filters)
      if (!filters.ok) return toToolError('invalid_arguments', filters.message)

      const page = getPage(parsedArgs)
      if (!page.ok) return toToolError('invalid_arguments', page.message)

      const pageSize = getPageSize(parsedArgs)
      if (!pageSize.ok) return toToolError('invalid_arguments', pageSize.message)

      const searchParams = new URLSearchParams({
        startAt: String(range.startAt),
        endAt: String(range.endAt),
        page: String(page.value),
        pageSize: String(pageSize.value),
      })

      const search = getString(parsedArgs.search)
      if (search) searchParams.set('search', search)
      appendFilters(searchParams, filters.value)

      const response = await requestUmamiJson({
        config,
        path: `websites/${websiteId}/events`,
        searchParams,
      })
      if (!response.ok) {
        return toToolError(response.error, response.message, buildResponseErrorDetail(response))
      }

      return toToolSuccess({
        ok: true,
        websiteId,
        startAt: new Date(range.startAt).toISOString(),
        endAt: new Date(range.endAt).toISOString(),
        events: response.data,
      })
    }

    case 'get_realtime': {
      const websiteId = getWebsiteId(parsedArgs)
      if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')

      const response = await requestUmamiJson({
        config,
        path: `realtime/${websiteId}`,
      })
      if (!response.ok) {
        return toToolError(response.error, response.message, buildResponseErrorDetail(response))
      }

      return toToolSuccess({
        ok: true,
        websiteId,
        realtime: response.data,
      })
    }

    default:
      return toToolError('method_not_found', `Unknown Umami tool: ${toolName}`)
  }
}

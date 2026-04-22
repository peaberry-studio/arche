import { getBoolean, getNonNegativeInteger, getPositiveInteger, getString, isRecord } from '@/lib/connectors/connector-values'
import { requestUmamiJson } from '@/lib/connectors/umami-client'
import {
  DEFAULT_LIST_PAGE_SIZE,
  DEFAULT_METRIC_LIMIT,
  DEFAULT_RANGE_MS,
  MAX_LIST_PAGE_SIZE,
  MAX_METRIC_LIMIT,
  METRIC_TYPES,
  TIME_UNITS,
  type MetricsType,
  type TimeUnit,
} from '@/lib/connectors/umami-tool-definitions'
import type {
  UmamiConnectorConfig,
  UmamiMcpToolResult,
  UmamiToolName,
} from '@/lib/connectors/umami-types'

type JsonRecord = Record<string, unknown>

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

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
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

type ToolHandler = (config: UmamiConnectorConfig, args: JsonRecord) => Promise<UmamiMcpToolResult>

function requireObjectArguments(args: unknown): JsonRecord {
  return isRecord(args) ? args : {}
}

const handleListWebsites: ToolHandler = async (config, args) => {
  const page = getPage(args)
  if (!page.ok) return toToolError('invalid_arguments', page.message)

  const pageSize = getPageSize(args)
  if (!pageSize.ok) return toToolError('invalid_arguments', pageSize.message)

  const searchParams = new URLSearchParams({
    page: String(page.value),
    pageSize: String(pageSize.value),
  })

  const search = getString(args.search)
  if (search) searchParams.set('search', search)

  const includeTeams = getBoolean(args.includeTeams)
  if (includeTeams !== undefined) {
    searchParams.set('includeTeams', includeTeams ? 'true' : 'false')
  }

  const response = await requestUmamiJson({ config, path: 'websites', searchParams })
  if (!response.ok) {
    return toToolError(response.error, response.message, buildResponseErrorDetail(response))
  }

  return toToolSuccess({ ok: true, websites: response.data })
}

const handleGetWebsiteStats: ToolHandler = async (config, args) => {
  const websiteId = getWebsiteId(args)
  if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')
  const encodedWebsiteId = encodePathSegment(websiteId)

  const range = getDateRange(args)
  if (!range.ok) return toToolError('invalid_arguments', range.message)

  const filters = getFilters(args.filters)
  if (!filters.ok) return toToolError('invalid_arguments', filters.message)

  const searchParams = new URLSearchParams({
    startAt: String(range.startAt),
    endAt: String(range.endAt),
  })

  const compare = getString(args.compare)
  if (compare) searchParams.set('compare', compare)
  appendFilters(searchParams, filters.value)

  const response = await requestUmamiJson({
    config,
    path: `websites/${encodedWebsiteId}/stats`,
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

const handleGetWebsitePageviews: ToolHandler = async (config, args) => {
  const websiteId = getWebsiteId(args)
  if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')
  const encodedWebsiteId = encodePathSegment(websiteId)

  const range = getDateRange(args)
  if (!range.ok) return toToolError('invalid_arguments', range.message)

  const filters = getFilters(args.filters)
  if (!filters.ok) return toToolError('invalid_arguments', filters.message)

  const searchParams = new URLSearchParams({
    startAt: String(range.startAt),
    endAt: String(range.endAt),
  })

  const unit = getTimeUnit(args.unit)
  if (args.unit !== undefined && !unit) {
    return toToolError('invalid_arguments', `unit must be one of: ${TIME_UNITS.join(', ')}`)
  }
  if (unit) searchParams.set('unit', unit)

  const timezone = getString(args.timezone)
  if (timezone) searchParams.set('timezone', timezone)

  const compare = getString(args.compare)
  if (compare) searchParams.set('compare', compare)
  appendFilters(searchParams, filters.value)

  const response = await requestUmamiJson({
    config,
    path: `websites/${encodedWebsiteId}/pageviews`,
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

const handleGetWebsiteMetrics: ToolHandler = async (config, args) => {
  const websiteId = getWebsiteId(args)
  if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')
  const encodedWebsiteId = encodePathSegment(websiteId)

  const type = getMetricType(args.type)
  if (!type) {
    return toToolError('invalid_arguments', `type must be one of: ${METRIC_TYPES.join(', ')}`)
  }

  const range = getDateRange(args)
  if (!range.ok) return toToolError('invalid_arguments', range.message)

  const filters = getFilters(args.filters)
  if (!filters.ok) return toToolError('invalid_arguments', filters.message)

  const limit = getMetricLimit(args)
  if (!limit.ok) return toToolError('invalid_arguments', limit.message)

  const offset = getOffset(args)
  if (!offset.ok) return toToolError('invalid_arguments', offset.message)

  const expanded = getBoolean(args.expanded) ?? false
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
    path: `websites/${encodedWebsiteId}/metrics${expanded ? '/expanded' : ''}`,
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

const handleListSessions: ToolHandler = async (config, args) => {
  const websiteId = getWebsiteId(args)
  if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')
  const encodedWebsiteId = encodePathSegment(websiteId)

  const range = getDateRange(args)
  if (!range.ok) return toToolError('invalid_arguments', range.message)

  const filters = getFilters(args.filters)
  if (!filters.ok) return toToolError('invalid_arguments', filters.message)

  const page = getPage(args)
  if (!page.ok) return toToolError('invalid_arguments', page.message)

  const pageSize = getPageSize(args)
  if (!pageSize.ok) return toToolError('invalid_arguments', pageSize.message)

  const searchParams = new URLSearchParams({
    startAt: String(range.startAt),
    endAt: String(range.endAt),
    page: String(page.value),
    pageSize: String(pageSize.value),
  })

  const search = getString(args.search)
  if (search) searchParams.set('search', search)
  appendFilters(searchParams, filters.value)

  const response = await requestUmamiJson({
    config,
    path: `websites/${encodedWebsiteId}/sessions`,
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

const handleListEvents: ToolHandler = async (config, args) => {
  const websiteId = getWebsiteId(args)
  if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')
  const encodedWebsiteId = encodePathSegment(websiteId)

  const range = getDateRange(args)
  if (!range.ok) return toToolError('invalid_arguments', range.message)

  const filters = getFilters(args.filters)
  if (!filters.ok) return toToolError('invalid_arguments', filters.message)

  const page = getPage(args)
  if (!page.ok) return toToolError('invalid_arguments', page.message)

  const pageSize = getPageSize(args)
  if (!pageSize.ok) return toToolError('invalid_arguments', pageSize.message)

  const searchParams = new URLSearchParams({
    startAt: String(range.startAt),
    endAt: String(range.endAt),
    page: String(page.value),
    pageSize: String(pageSize.value),
  })

  const search = getString(args.search)
  if (search) searchParams.set('search', search)
  appendFilters(searchParams, filters.value)

  const response = await requestUmamiJson({
    config,
    path: `websites/${encodedWebsiteId}/events`,
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

const handleGetRealtime: ToolHandler = async (config, args) => {
  const websiteId = getWebsiteId(args)
  if (!websiteId) return toToolError('invalid_arguments', 'websiteId is required')
  const encodedWebsiteId = encodePathSegment(websiteId)

  const response = await requestUmamiJson({
    config,
    path: `realtime/${encodedWebsiteId}`,
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

const UMAMI_TOOL_HANDLERS: Record<UmamiToolName, ToolHandler> = {
  list_websites: handleListWebsites,
  get_website_stats: handleGetWebsiteStats,
  get_website_pageviews: handleGetWebsitePageviews,
  get_website_metrics: handleGetWebsiteMetrics,
  list_sessions: handleListSessions,
  list_events: handleListEvents,
  get_realtime: handleGetRealtime,
}

export async function executeUmamiMcpTool(
  config: UmamiConnectorConfig,
  toolName: string,
  args: unknown
): Promise<UmamiMcpToolResult> {
  const parsedArgs = requireObjectArguments(args)

  const handler = UMAMI_TOOL_HANDLERS[toolName as UmamiToolName]
  if (!handler) {
    return toToolError('method_not_found', `Unknown Umami tool: ${toolName}`)
  }

  return handler(config, parsedArgs)
}

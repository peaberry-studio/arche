import type { ZendeskApiResponse, ZendeskConnectorConfig } from '@/lib/connectors/zendesk-types'
import { getBoolean, getPositiveInteger, getString, getStringArray, isRecord } from '@/lib/connectors/zendesk-values'

const ZENDESK_API_BASE_PATH = '/api/v2'
const ZENDESK_TIMEOUT_MS = 15_000

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

  if (!isRecord(payload)) {
    return undefined
  }

  const directKeys = ['description', 'details', 'message', 'error', 'title']
  for (const key of directKeys) {
    const value = getString(payload[key])
    if (value) return value
  }

  const errors = payload.errors
  if (Array.isArray(errors)) {
    const value = errors
      .map((entry) => getString(entry))
      .filter((entry): entry is string => Boolean(entry))
      .join('; ')
    if (value) return value
  }

  return undefined
}

export function mapTicket(ticket: unknown, subdomain: string): Record<string, unknown> {
  const record = isRecord(ticket) ? ticket : {}

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

export function mapTicketComment(comment: unknown): Record<string, unknown> {
  const record = isRecord(comment) ? comment : {}

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

export async function requestZendeskJson(input: {
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
        message: detail
          ? `Zendesk request failed (${response.status}): ${detail}`
          : `Zendesk request failed (${response.status})`,
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

export async function testZendeskConnection(config: ZendeskConnectorConfig): Promise<ZendeskApiResponse> {
  return requestZendeskJson({
    config,
    path: '/users/me.json',
  })
}

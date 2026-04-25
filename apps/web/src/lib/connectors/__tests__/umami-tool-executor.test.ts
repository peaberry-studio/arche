import { beforeEach, describe, expect, it, vi } from 'vitest'

import { executeUmamiMcpTool } from '@/lib/connectors/umami-tool-executor'
import {
  DEFAULT_LIST_PAGE_SIZE,
  DEFAULT_METRIC_LIMIT,
  DEFAULT_RANGE_MS,
  MAX_LIST_PAGE_SIZE,
  MAX_METRIC_LIMIT,
} from '@/lib/connectors/umami-tool-definitions'
import type { UmamiConnectorConfig, UmamiMcpToolResult } from '@/lib/connectors/umami-types'

const umamiClientMocks = vi.hoisted(() => ({
  requestUmamiJson: vi.fn(),
}))

vi.mock('@/lib/connectors/umami-client', () => ({
  requestUmamiJson: umamiClientMocks.requestUmamiJson,
}))

const NOW = 1714000000000

const dateNowMocks = vi.hoisted(() => ({
  dateNow: vi.fn(() => NOW),
}))

vi.mock(import.meta.url, () => ({}))

const config: UmamiConnectorConfig = {
  authMethod: 'api-key',
  baseUrl: 'https://api.umami.is/v1',
  apiKey: 'api-key-123',
}

function parseToolResult(result: UmamiMcpToolResult): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null')
}

function getSearchParams(): URLSearchParams {
  const call = umamiClientMocks.requestUmamiJson.mock.calls[0] as [{ searchParams?: URLSearchParams }]
  return call[0].searchParams ?? new URLSearchParams()
}

function getPath(): string {
  const call = umamiClientMocks.requestUmamiJson.mock.calls[0] as [{ path: string }]
  return call[0].path
}

function mockOkResponse(data: unknown = { data: [] }) {
  umamiClientMocks.requestUmamiJson.mockResolvedValue({
    ok: true,
    data,
    status: 200,
    headers: new Headers(),
  })
}

function mockErrorResponse(opts: {
  error?: string
  message?: string
  status?: number
  retryAfter?: number
  data?: unknown
} = {}) {
  umamiClientMocks.requestUmamiJson.mockResolvedValue({
    ok: false,
    error: opts.error ?? 'umami_request_failed',
    message: opts.message ?? 'Umami request failed (500)',
    status: opts.status ?? 500,
    ...(opts.retryAfter !== undefined ? { retryAfter: opts.retryAfter } : {}),
    ...(opts.data !== undefined ? { data: opts.data } : {}),
  })
}

describe('umami-tool-executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    mockOkResponse()
  })

  // ── Unknown tool ──────────────────────────────────────────────────

  describe('unknown tool', () => {
    it('returns an error for an unrecognized tool name', async () => {
      const result = await executeUmamiMcpTool(config, 'nonexistent_tool', {})
      const parsed = parseToolResult(result)

      expect(result.isError).toBe(true)
      expect(parsed).toEqual({
        ok: false,
        error: 'method_not_found',
        message: 'Unknown Umami tool: nonexistent_tool',
      })
      expect(umamiClientMocks.requestUmamiJson).not.toHaveBeenCalled()
    })

    it('handles non-object args gracefully', async () => {
      const result = await executeUmamiMcpTool(config, 'list_websites', 'not-an-object')
      expect(result.isError).toBeUndefined()
      expect(umamiClientMocks.requestUmamiJson).toHaveBeenCalled()
    })

    it('handles null args', async () => {
      const result = await executeUmamiMcpTool(config, 'list_websites', null)
      expect(result.isError).toBeUndefined()
    })

    it('handles undefined args', async () => {
      const result = await executeUmamiMcpTool(config, 'list_websites', undefined)
      expect(result.isError).toBeUndefined()
    })
  })

  // ── list_websites ─────────────────────────────────────────────────

  describe('list_websites', () => {
    it('calls the websites endpoint with default pagination', async () => {
      const result = await executeUmamiMcpTool(config, 'list_websites', {})

      expect(umamiClientMocks.requestUmamiJson).toHaveBeenCalledWith({
        config,
        path: 'websites',
        searchParams: expect.any(URLSearchParams),
      })
      const sp = getSearchParams()
      expect(sp.get('page')).toBe('1')
      expect(sp.get('pageSize')).toBe(String(DEFAULT_LIST_PAGE_SIZE))
      expect(parseToolResult(result)).toEqual({ ok: true, websites: { data: [] } })
    })

    it('passes search, page, pageSize, and includeTeams', async () => {
      await executeUmamiMcpTool(config, 'list_websites', {
        search: 'blog',
        page: 3,
        pageSize: 50,
        includeTeams: true,
      })

      const sp = getSearchParams()
      expect(sp.get('search')).toBe('blog')
      expect(sp.get('page')).toBe('3')
      expect(sp.get('pageSize')).toBe('50')
      expect(sp.get('includeTeams')).toBe('true')
    })

    it('sets includeTeams=false when explicitly false', async () => {
      await executeUmamiMcpTool(config, 'list_websites', { includeTeams: false })
      expect(getSearchParams().get('includeTeams')).toBe('false')
    })

    it('omits includeTeams when not provided', async () => {
      await executeUmamiMcpTool(config, 'list_websites', {})
      expect(getSearchParams().has('includeTeams')).toBe(false)
    })

    it('rejects invalid page', async () => {
      const result = await executeUmamiMcpTool(config, 'list_websites', { page: -1 })
      expect(result.isError).toBe(true)
      expect(parseToolResult(result)).toMatchObject({ error: 'invalid_arguments' })
      expect(umamiClientMocks.requestUmamiJson).not.toHaveBeenCalled()
    })

    it('rejects page = 0', async () => {
      const result = await executeUmamiMcpTool(config, 'list_websites', { page: 0 })
      expect(result.isError).toBe(true)
    })

    it('rejects invalid pageSize', async () => {
      const result = await executeUmamiMcpTool(config, 'list_websites', { pageSize: 0 })
      expect(result.isError).toBe(true)
      expect(umamiClientMocks.requestUmamiJson).not.toHaveBeenCalled()
    })

    it('rejects pageSize exceeding the maximum', async () => {
      const result = await executeUmamiMcpTool(config, 'list_websites', {
        pageSize: MAX_LIST_PAGE_SIZE + 1,
      })
      expect(result.isError).toBe(true)
      const parsed = parseToolResult(result) as { message: string }
      expect(parsed.message).toContain(String(MAX_LIST_PAGE_SIZE))
    })

    it('forwards API errors from the client', async () => {
      mockErrorResponse({ status: 429, retryAfter: 30, data: { detail: 'rate limited' } })

      const result = await executeUmamiMcpTool(config, 'list_websites', {})
      expect(result.isError).toBe(true)
      const parsed = parseToolResult(result) as Record<string, unknown>
      expect(parsed.status).toBe(429)
      expect(parsed.retryAfter).toBe(30)
      expect(parsed.detail).toEqual({ detail: 'rate limited' })
    })
  })

  // ── get_website_stats ─────────────────────────────────────────────

  describe('get_website_stats', () => {
    it('requires websiteId', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_stats', {})
      expect(result.isError).toBe(true)
      expect(parseToolResult(result)).toMatchObject({ message: 'websiteId is required' })
      expect(umamiClientMocks.requestUmamiJson).not.toHaveBeenCalled()
    })

    it('uses default date range when startAt/endAt are omitted', async () => {
      await executeUmamiMcpTool(config, 'get_website_stats', { websiteId: 'site-1' })

      const sp = getSearchParams()
      expect(sp.get('endAt')).toBe(String(NOW))
      expect(sp.get('startAt')).toBe(String(NOW - DEFAULT_RANGE_MS))
    })

    it('parses ISO date strings for startAt/endAt', async () => {
      await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        startAt: '2026-01-01T00:00:00.000Z',
        endAt: '2026-01-02T00:00:00.000Z',
      })

      const sp = getSearchParams()
      expect(sp.get('startAt')).toBe(String(Date.parse('2026-01-01T00:00:00.000Z')))
      expect(sp.get('endAt')).toBe(String(Date.parse('2026-01-02T00:00:00.000Z')))
    })

    it('parses numeric timestamps', async () => {
      await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        startAt: 1700000000000,
        endAt: 1700100000000,
      })

      const sp = getSearchParams()
      expect(sp.get('startAt')).toBe('1700000000000')
      expect(sp.get('endAt')).toBe('1700100000000')
    })

    it('parses string-encoded numeric timestamps', async () => {
      await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        startAt: '1700000000000',
        endAt: '1700100000000',
      })

      const sp = getSearchParams()
      expect(sp.get('startAt')).toBe('1700000000000')
      expect(sp.get('endAt')).toBe('1700100000000')
    })

    it('rejects startAt >= endAt', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        startAt: '2026-01-02T00:00:00.000Z',
        endAt: '2026-01-01T00:00:00.000Z',
      })
      expect(result.isError).toBe(true)
      expect(parseToolResult(result)).toMatchObject({
        message: 'startAt must be earlier than endAt',
      })
    })

    it('rejects startAt == endAt', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        startAt: '2026-01-01T00:00:00.000Z',
        endAt: '2026-01-01T00:00:00.000Z',
      })
      expect(result.isError).toBe(true)
    })

    it('rejects invalid startAt values', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        startAt: 'not-a-date',
      })
      expect(result.isError).toBe(true)
    })

    it('rejects negative timestamps', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        startAt: -100,
      })
      expect(result.isError).toBe(true)
    })

    it('rejects zero timestamps', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        startAt: 0,
      })
      expect(result.isError).toBe(true)
    })

    it('passes compare parameter', async () => {
      await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        compare: 'prev',
      })
      expect(getSearchParams().get('compare')).toBe('prev')
    })

    it('passes filters into search params', async () => {
      await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        filters: { browser: 'Chrome', country: 'US' },
      })
      const sp = getSearchParams()
      expect(sp.get('browser')).toBe('Chrome')
      expect(sp.get('country')).toBe('US')
    })

    it('typed parameters take precedence over colliding filter keys', async () => {
      await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        startAt: '2026-01-01T00:00:00.000Z',
        endAt: '2026-01-02T00:00:00.000Z',
        compare: 'prev',
        filters: {
          startAt: '999',
          compare: 'yoy',
          event: 'signup',
        },
      })

      const sp = getSearchParams()
      // Typed params win over filters
      expect(sp.get('startAt')).toBe(String(Date.parse('2026-01-01T00:00:00.000Z')))
      expect(sp.get('compare')).toBe('prev')
      // Non-colliding filters pass through
      expect(sp.get('event')).toBe('signup')
    })

    it('rejects non-object filters', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        filters: 'not-an-object',
      })
      expect(result.isError).toBe(true)
    })

    it('rejects filters with non-string values', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        filters: { browser: 123 },
      })
      expect(result.isError).toBe(true)
    })

    it('rejects filters with empty string values', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        filters: { browser: '' },
      })
      expect(result.isError).toBe(true)
    })

    it('includes date range in the success response', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        startAt: '2026-01-01T00:00:00.000Z',
        endAt: '2026-01-02T00:00:00.000Z',
      })
      const parsed = parseToolResult(result) as Record<string, unknown>
      expect(parsed.ok).toBe(true)
      expect(parsed.websiteId).toBe('site-1')
      expect(parsed.startAt).toBe('2026-01-01T00:00:00.000Z')
      expect(parsed.endAt).toBe('2026-01-02T00:00:00.000Z')
    })

    it('calls the correct API path', async () => {
      await executeUmamiMcpTool(config, 'get_website_stats', { websiteId: 'site-1' })
      expect(getPath()).toBe('websites/site-1/stats')
    })
  })

  // ── get_website_pageviews ─────────────────────────────────────────

  describe('get_website_pageviews', () => {
    it('requires websiteId', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_pageviews', {})
      expect(result.isError).toBe(true)
    })

    it('passes unit, timezone, and compare', async () => {
      await executeUmamiMcpTool(config, 'get_website_pageviews', {
        websiteId: 'site-1',
        unit: 'day',
        timezone: 'Europe/Madrid',
        compare: 'yoy',
      })
      const sp = getSearchParams()
      expect(sp.get('unit')).toBe('day')
      expect(sp.get('timezone')).toBe('Europe/Madrid')
      expect(sp.get('compare')).toBe('yoy')
    })

    it('rejects invalid unit', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_pageviews', {
        websiteId: 'site-1',
        unit: 'century',
      })
      expect(result.isError).toBe(true)
      const parsed = parseToolResult(result) as { message: string }
      expect(parsed.message).toContain('unit must be one of')
    })

    it('omits unit from search params when not provided', async () => {
      await executeUmamiMcpTool(config, 'get_website_pageviews', {
        websiteId: 'site-1',
      })
      expect(getSearchParams().has('unit')).toBe(false)
    })

    it('calls the correct API path', async () => {
      await executeUmamiMcpTool(config, 'get_website_pageviews', { websiteId: 'site-1' })
      expect(getPath()).toBe('websites/site-1/pageviews')
    })

    it('passes filters', async () => {
      await executeUmamiMcpTool(config, 'get_website_pageviews', {
        websiteId: 'site-1',
        filters: { path: '/blog' },
      })
      expect(getSearchParams().get('path')).toBe('/blog')
    })

    it('returns pageviews key in the response', async () => {
      mockOkResponse({ pageviews: [1, 2, 3] })
      const result = await executeUmamiMcpTool(config, 'get_website_pageviews', {
        websiteId: 'site-1',
      })
      const parsed = parseToolResult(result) as Record<string, unknown>
      expect(parsed.ok).toBe(true)
      expect(parsed.pageviews).toEqual({ pageviews: [1, 2, 3] })
    })
  })

  // ── get_website_metrics ───────────────────────────────────────────

  describe('get_website_metrics', () => {
    it('requires websiteId', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_metrics', {
        type: 'path',
      })
      expect(result.isError).toBe(true)
    })

    it('requires a valid metric type', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'invalid_type',
      })
      expect(result.isError).toBe(true)
      const parsed = parseToolResult(result) as { message: string }
      expect(parsed.message).toContain('type must be one of')
    })

    it('requires type to be present', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
      })
      expect(result.isError).toBe(true)
    })

    it('uses the non-expanded metrics endpoint by default', async () => {
      await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'country',
      })
      expect(getPath()).toBe('websites/site-1/metrics')
    })

    it('routes expanded=true to the expanded endpoint', async () => {
      await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'country',
        expanded: true,
      })
      expect(getPath()).toBe('websites/site-1/metrics/expanded')
    })

    it('routes expanded=false to the standard endpoint', async () => {
      await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'path',
        expanded: false,
      })
      expect(getPath()).toBe('websites/site-1/metrics')
    })

    it('uses default limit and offset', async () => {
      await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'browser',
      })
      const sp = getSearchParams()
      expect(sp.get('limit')).toBe(String(DEFAULT_METRIC_LIMIT))
      expect(sp.get('offset')).toBe('0')
    })

    it('passes custom limit and offset', async () => {
      await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'browser',
        limit: 50,
        offset: 10,
      })
      const sp = getSearchParams()
      expect(sp.get('limit')).toBe('50')
      expect(sp.get('offset')).toBe('10')
    })

    it('rejects limit exceeding the maximum', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'path',
        limit: MAX_METRIC_LIMIT + 1,
      })
      expect(result.isError).toBe(true)
      const parsed = parseToolResult(result) as { message: string }
      expect(parsed.message).toContain(String(MAX_METRIC_LIMIT))
    })

    it('rejects invalid limit', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'path',
        limit: -5,
      })
      expect(result.isError).toBe(true)
    })

    it('rejects limit = 0', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'path',
        limit: 0,
      })
      expect(result.isError).toBe(true)
    })

    it('rejects negative offset', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'path',
        offset: -1,
      })
      expect(result.isError).toBe(true)
    })

    it('allows offset = 0', async () => {
      await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'path',
        offset: 0,
      })
      expect(getSearchParams().get('offset')).toBe('0')
    })

    it('passes type in search params', async () => {
      await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'referrer',
      })
      expect(getSearchParams().get('type')).toBe('referrer')
    })

    it('includes type and expanded in the response', async () => {
      const result = await executeUmamiMcpTool(config, 'get_website_metrics', {
        websiteId: 'site-1',
        type: 'country',
        expanded: true,
      })
      const parsed = parseToolResult(result) as Record<string, unknown>
      expect(parsed.type).toBe('country')
      expect(parsed.expanded).toBe(true)
    })

    it('accepts all valid metric types', async () => {
      const validTypes = [
        'path', 'entry', 'exit', 'title', 'query', 'referrer', 'channel',
        'domain', 'country', 'region', 'city', 'browser', 'os', 'device',
        'language', 'screen', 'event', 'hostname', 'tag', 'distinctId',
      ]
      for (const type of validTypes) {
        vi.clearAllMocks()
        mockOkResponse()
        const result = await executeUmamiMcpTool(config, 'get_website_metrics', {
          websiteId: 'site-1',
          type,
        })
        expect(result.isError).toBeUndefined()
        expect(getSearchParams().get('type')).toBe(type)
      }
    })
  })

  // ── list_sessions ─────────────────────────────────────────────────

  describe('list_sessions', () => {
    it('requires websiteId', async () => {
      const result = await executeUmamiMcpTool(config, 'list_sessions', {})
      expect(result.isError).toBe(true)
      expect(umamiClientMocks.requestUmamiJson).not.toHaveBeenCalled()
    })

    it('calls the sessions endpoint with default pagination and date range', async () => {
      await executeUmamiMcpTool(config, 'list_sessions', { websiteId: 'site-1' })

      expect(getPath()).toBe('websites/site-1/sessions')
      const sp = getSearchParams()
      expect(sp.get('page')).toBe('1')
      expect(sp.get('pageSize')).toBe(String(DEFAULT_LIST_PAGE_SIZE))
      expect(sp.get('startAt')).toBe(String(NOW - DEFAULT_RANGE_MS))
      expect(sp.get('endAt')).toBe(String(NOW))
    })

    it('passes search, page, pageSize, date range, and filters', async () => {
      await executeUmamiMcpTool(config, 'list_sessions', {
        websiteId: 'site-1',
        search: 'mobile',
        page: 2,
        pageSize: 25,
        startAt: '2026-01-01T00:00:00.000Z',
        endAt: '2026-01-02T00:00:00.000Z',
        filters: { browser: 'Firefox' },
      })

      const sp = getSearchParams()
      expect(sp.get('search')).toBe('mobile')
      expect(sp.get('page')).toBe('2')
      expect(sp.get('pageSize')).toBe('25')
      expect(sp.get('browser')).toBe('Firefox')
    })

    it('returns sessions key in success response', async () => {
      mockOkResponse([{ id: 'sess-1' }])
      const result = await executeUmamiMcpTool(config, 'list_sessions', { websiteId: 'site-1' })
      const parsed = parseToolResult(result) as Record<string, unknown>
      expect(parsed.ok).toBe(true)
      expect(parsed.sessions).toEqual([{ id: 'sess-1' }])
      expect(parsed.websiteId).toBe('site-1')
    })
  })

  // ── list_events ───────────────────────────────────────────────────

  describe('list_events', () => {
    it('requires websiteId', async () => {
      const result = await executeUmamiMcpTool(config, 'list_events', {})
      expect(result.isError).toBe(true)
      expect(umamiClientMocks.requestUmamiJson).not.toHaveBeenCalled()
    })

    it('calls the events endpoint with default pagination and date range', async () => {
      await executeUmamiMcpTool(config, 'list_events', { websiteId: 'site-1' })

      expect(getPath()).toBe('websites/site-1/events')
      const sp = getSearchParams()
      expect(sp.get('page')).toBe('1')
      expect(sp.get('pageSize')).toBe(String(DEFAULT_LIST_PAGE_SIZE))
    })

    it('passes search, page, pageSize, date range, and filters', async () => {
      await executeUmamiMcpTool(config, 'list_events', {
        websiteId: 'site-1',
        search: 'click',
        page: 5,
        pageSize: 10,
        startAt: '2026-03-01T00:00:00.000Z',
        endAt: '2026-03-02T00:00:00.000Z',
        filters: { event: 'signup' },
      })

      const sp = getSearchParams()
      expect(sp.get('search')).toBe('click')
      expect(sp.get('page')).toBe('5')
      expect(sp.get('pageSize')).toBe('10')
      expect(sp.get('event')).toBe('signup')
    })

    it('returns events key in success response', async () => {
      mockOkResponse([{ id: 'evt-1' }])
      const result = await executeUmamiMcpTool(config, 'list_events', { websiteId: 'site-1' })
      const parsed = parseToolResult(result) as Record<string, unknown>
      expect(parsed.ok).toBe(true)
      expect(parsed.events).toEqual([{ id: 'evt-1' }])
    })
  })

  // ── get_realtime ──────────────────────────────────────────────────

  describe('get_realtime', () => {
    it('requires websiteId', async () => {
      const result = await executeUmamiMcpTool(config, 'get_realtime', {})
      expect(result.isError).toBe(true)
      expect(parseToolResult(result)).toMatchObject({ message: 'websiteId is required' })
      expect(umamiClientMocks.requestUmamiJson).not.toHaveBeenCalled()
    })

    it('calls the realtime endpoint', async () => {
      await executeUmamiMcpTool(config, 'get_realtime', { websiteId: 'site-1' })

      expect(umamiClientMocks.requestUmamiJson).toHaveBeenCalledWith({
        config,
        path: 'realtime/site-1',
      })
    })

    it('does not send searchParams', async () => {
      await executeUmamiMcpTool(config, 'get_realtime', { websiteId: 'site-1' })
      const call = umamiClientMocks.requestUmamiJson.mock.calls[0] as [Record<string, unknown>]
      expect(call[0].searchParams).toBeUndefined()
    })

    it('returns realtime key in the success response', async () => {
      mockOkResponse({ activeVisitors: 5, pages: [] })
      const result = await executeUmamiMcpTool(config, 'get_realtime', { websiteId: 'site-1' })
      const parsed = parseToolResult(result) as Record<string, unknown>
      expect(parsed.ok).toBe(true)
      expect(parsed.websiteId).toBe('site-1')
      expect(parsed.realtime).toEqual({ activeVisitors: 5, pages: [] })
    })

    it('encodes websiteId to prevent path traversal', async () => {
      await executeUmamiMcpTool(config, 'get_realtime', { websiteId: '../../users' })
      expect(getPath()).toBe('realtime/..%2F..%2Fusers')
    })

    it('encodes special characters in websiteId', async () => {
      await executeUmamiMcpTool(config, 'get_realtime', { websiteId: 'site with spaces' })
      expect(getPath()).toBe('realtime/site%20with%20spaces')
    })
  })

  // ── API error forwarding ──────────────────────────────────────────

  describe('API error forwarding', () => {
    it('includes status and retryAfter in tool error', async () => {
      mockErrorResponse({
        error: 'umami_request_failed',
        message: 'Umami request failed (429): Too many requests',
        status: 429,
        retryAfter: 60,
      })

      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
      })

      expect(result.isError).toBe(true)
      const parsed = parseToolResult(result) as Record<string, unknown>
      expect(parsed.error).toBe('umami_request_failed')
      expect(parsed.status).toBe(429)
      expect(parsed.retryAfter).toBe(60)
    })

    it('includes data detail in tool error', async () => {
      mockErrorResponse({
        status: 500,
        data: { internal: 'server error' },
      })

      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
      })
      const parsed = parseToolResult(result) as Record<string, unknown>
      expect(parsed.detail).toEqual({ internal: 'server error' })
    })

    it('omits retryAfter when not present in the response', async () => {
      mockErrorResponse({ status: 500 })

      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
      })
      const parsed = parseToolResult(result) as Record<string, unknown>
      expect(parsed).not.toHaveProperty('retryAfter')
    })

    it('omits detail when data is not present in the response', async () => {
      mockErrorResponse({ status: 500 })

      const result = await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
      })
      const parsed = parseToolResult(result) as Record<string, unknown>
      expect(parsed).not.toHaveProperty('detail')
    })
  })

  // ── Path encoding ─────────────────────────────────────────────────

  describe('path encoding', () => {
    const toolsWithWebsiteId = [
      { tool: 'get_website_stats', pathPrefix: 'websites/', pathSuffix: '/stats' },
      { tool: 'get_website_pageviews', pathPrefix: 'websites/', pathSuffix: '/pageviews' },
      { tool: 'get_website_metrics', pathPrefix: 'websites/', pathSuffix: '/metrics', extraArgs: { type: 'path' } },
      { tool: 'list_sessions', pathPrefix: 'websites/', pathSuffix: '/sessions' },
      { tool: 'list_events', pathPrefix: 'websites/', pathSuffix: '/events' },
      { tool: 'get_realtime', pathPrefix: 'realtime/', pathSuffix: '' },
    ] as const

    for (const { tool, pathPrefix, pathSuffix, ...rest } of toolsWithWebsiteId) {
      it(`${tool}: encodes websiteId in the path`, async () => {
        vi.clearAllMocks()
        mockOkResponse()
        const extraArgs = 'extraArgs' in rest ? (rest as { extraArgs: Record<string, string> }).extraArgs : {}
        await executeUmamiMcpTool(config, tool, {
          websiteId: 'id/with/slashes',
          ...extraArgs,
        })
        expect(getPath()).toBe(`${pathPrefix}id%2Fwith%2Fslashes${pathSuffix}`)
      })
    }
  })

  // ── Time unit validation ──────────────────────────────────────────

  describe('time unit validation', () => {
    const validUnits = ['minute', 'hour', 'day', 'month', 'year']
    for (const unit of validUnits) {
      it(`accepts valid unit: ${unit}`, async () => {
        vi.clearAllMocks()
        mockOkResponse()
        const result = await executeUmamiMcpTool(config, 'get_website_pageviews', {
          websiteId: 'site-1',
          unit,
        })
        expect(result.isError).toBeUndefined()
        expect(getSearchParams().get('unit')).toBe(unit)
      })
    }
  })

  // ── Empty filters ─────────────────────────────────────────────────

  describe('empty filters', () => {
    it('treats undefined filters as an empty object (no extra params)', async () => {
      await executeUmamiMcpTool(config, 'get_website_stats', { websiteId: 'site-1' })
      const sp = getSearchParams()
      // Only expected params: startAt, endAt
      expect([...sp.keys()].sort()).toEqual(['endAt', 'startAt'])
    })
  })

  // ── Accepts float timestamps and floors them ──────────────────────

  describe('timestamp flooring', () => {
    it('floors float timestamps to integers', async () => {
      await executeUmamiMcpTool(config, 'get_website_stats', {
        websiteId: 'site-1',
        startAt: 1700000000000.7,
        endAt: 1700100000000.3,
      })
      const sp = getSearchParams()
      expect(sp.get('startAt')).toBe('1700000000000')
      expect(sp.get('endAt')).toBe('1700100000000')
    })
  })
})

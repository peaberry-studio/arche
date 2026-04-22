import { afterEach, describe, expect, it, vi } from 'vitest'

import { executeAhrefsMcpTool, getAhrefsMcpTools } from '@/lib/connectors/ahrefs'
import type { AhrefsConnectorConfig, AhrefsMcpToolResult } from '@/lib/connectors/ahrefs-types'

function buildConfig(): AhrefsConnectorConfig {
  return {
    apiKey: 'ahrefs-api-key-123',
  }
}

function parseToolResult(result: AhrefsMcpToolResult): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null')
}

describe('ahrefs-tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists all read-only tools', () => {
    const tools = getAhrefsMcpTools()
    const names = tools.map((t) => t.name)

    expect(names).toEqual([
      'get_domain_rating',
      'get_site_metrics',
      'get_backlinks',
      'get_organic_keywords',
      'get_top_pages',
      'get_keyword_overview',
      'get_serp_overview',
      'get_subscription_limits',
    ])
  })

  it('returns error for unknown tool', async () => {
    const result = await executeAhrefsMcpTool(buildConfig(), 'unknown_tool', {})
    expect(parseToolResult(result)).toEqual({
      ok: false,
      error: 'tool_not_found',
      message: 'Tool not found: unknown_tool',
    })
    expect(result.isError).toBe(true)
  })

  it('returns error when target is missing for get_domain_rating', async () => {
    const result = await executeAhrefsMcpTool(buildConfig(), 'get_domain_rating', {})
    expect(parseToolResult(result)).toEqual({
      ok: false,
      error: 'invalid_arguments',
      message: 'target is required',
    })
    expect(result.isError).toBe(true)
  })

  it.each([
    'get_domain_rating',
    'get_site_metrics',
    'get_organic_keywords',
    'get_top_pages',
  ])('returns error when date is missing for %s', async (toolName) => {
    const result = await executeAhrefsMcpTool(buildConfig(), toolName, {
      target: 'example.com',
    })

    expect(parseToolResult(result)).toEqual({
      ok: false,
      error: 'invalid_arguments',
      message: 'date is required',
    })
    expect(result.isError).toBe(true)
  })

  it('calls the Ahrefs API for get_domain_rating', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ domain_rating: { domain_rating: 85, ahrefs_rank: 1234 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeAhrefsMcpTool(buildConfig(), 'get_domain_rating', {
      target: 'example.com',
      date: '2024-01-01',
    })

    expect(parseToolResult(result)).toEqual({
      domain_rating: { domain_rating: 85, ahrefs_rank: 1234 },
    })

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v3/site-explorer/domain-rating')
    expect(url.searchParams.get('target')).toBe('example.com')
    expect(url.searchParams.get('date')).toBe('2024-01-01')
    expect(url.searchParams.get('protocol')).toBe('both')
  })

  it('calls the Ahrefs API for get_site_metrics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          metrics: {
            org_keywords: 1500,
            org_traffic: 50000,
            paid_keywords: 10,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeAhrefsMcpTool(buildConfig(), 'get_site_metrics', {
      target: 'example.com',
      date: '2024-01-01',
      country: 'us',
      mode: 'domain',
    })

    expect(parseToolResult(result)).toEqual({
      metrics: {
        org_keywords: 1500,
        org_traffic: 50000,
        paid_keywords: 10,
      },
    })

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v3/site-explorer/metrics')
    expect(url.searchParams.get('target')).toBe('example.com')
    expect(url.searchParams.get('date')).toBe('2024-01-01')
    expect(url.searchParams.get('country')).toBe('us')
    expect(url.searchParams.get('mode')).toBe('domain')
  })

  it('uses documented select fields for get_organic_keywords', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keywords: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await executeAhrefsMcpTool(buildConfig(), 'get_organic_keywords', {
      target: 'example.com',
      date: '2024-01-01',
    })

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v3/site-explorer/organic-keywords')
    expect(url.searchParams.get('date')).toBe('2024-01-01')
    expect(url.searchParams.get('select')).toBe(
      'keyword,keyword_country,volume,keyword_difficulty,sum_traffic,cpc,best_position'
    )
  })

  it('calls the Ahrefs API for get_keyword_overview', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          keywords: [
            { keyword: 'seo tools', volume: 12000, difficulty: 45 },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeAhrefsMcpTool(buildConfig(), 'get_keyword_overview', {
      keywords: 'seo tools',
      country: 'us',
    })

    expect(parseToolResult(result)).toEqual({
      keywords: [{ keyword: 'seo tools', volume: 12000, difficulty: 45 }],
    })

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v3/keywords-explorer/overview')
    expect(url.searchParams.get('keywords')).toBe('seo tools')
    expect(url.searchParams.get('country')).toBe('us')
  })

  it('calls the Ahrefs API for get_subscription_limits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          limits_and_usage: {
            subscription: 'Lite',
            units_limit_workspace: 500,
            units_usage_workspace: 120,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeAhrefsMcpTool(buildConfig(), 'get_subscription_limits', {})

    expect(parseToolResult(result)).toEqual({
      limits_and_usage: {
        subscription: 'Lite',
        units_limit_workspace: 500,
        units_usage_workspace: 120,
      },
    })

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v3/subscription-info/limits-and-usage')
  })

  it('surfaces Ahrefs API errors with retry-after', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '30' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeAhrefsMcpTool(buildConfig(), 'get_domain_rating', {
      target: 'example.com',
      date: '2024-01-01',
    })

    expect(parseToolResult(result)).toEqual({
      ok: false,
      error: 'ahrefs_request_failed',
      message: 'Ahrefs request failed (429): Rate limit exceeded',
      retryAfter: 30,
    })
    expect(result.isError).toBe(true)
  })

  it('limits backlinks to max 1000', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ backlinks: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await executeAhrefsMcpTool(buildConfig(), 'get_backlinks', {
      target: 'example.com',
      limit: 5000,
    })

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.searchParams.get('limit')).toBe('1000')
  })
})

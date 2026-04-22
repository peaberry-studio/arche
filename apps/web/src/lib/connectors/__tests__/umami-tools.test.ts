import { beforeEach, describe, expect, it, vi } from 'vitest'

import { executeUmamiMcpTool, getUmamiMcpTools } from '@/lib/connectors/umami'

const umamiClientMocks = vi.hoisted(() => ({
  requestUmamiJson: vi.fn(),
}))

vi.mock('@/lib/connectors/umami-client', () => ({
  requestUmamiJson: umamiClientMocks.requestUmamiJson,
}))

const config = {
  authMethod: 'api-key' as const,
  baseUrl: 'https://api.umami.is/v1',
  apiKey: 'api-key-123',
}

function parseToolResult(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null')
}

describe('umami-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    umamiClientMocks.requestUmamiJson.mockResolvedValue({
      ok: true,
      data: { data: [] },
      status: 200,
      headers: new Headers(),
    })
  })

  it('exposes the expected read-only tool set', () => {
    expect(getUmamiMcpTools().map((tool) => tool.name)).toEqual([
      'list_websites',
      'get_website_stats',
      'get_website_pageviews',
      'get_website_metrics',
      'list_sessions',
      'list_events',
      'get_realtime',
    ])
  })

  it('lists websites through the Umami API client', async () => {
    const result = await executeUmamiMcpTool(config, 'list_websites', {
      includeTeams: true,
      page: 2,
      pageSize: 10,
      search: 'marketing',
    })

    expect(umamiClientMocks.requestUmamiJson).toHaveBeenCalledWith({
      config,
      path: 'websites',
      searchParams: expect.any(URLSearchParams),
    })

    const [request] = umamiClientMocks.requestUmamiJson.mock.calls[0] as [{
      searchParams: URLSearchParams
    }]
    expect(request.searchParams.toString()).toBe('page=2&pageSize=10&search=marketing&includeTeams=true')
    expect(parseToolResult(result)).toEqual({ ok: true, websites: { data: [] } })
  })

  it('routes expanded metrics to the dedicated Umami endpoint', async () => {
    await executeUmamiMcpTool(config, 'get_website_metrics', {
      websiteId: 'site-1',
      type: 'country',
      expanded: true,
    })

    expect(umamiClientMocks.requestUmamiJson).toHaveBeenCalledWith({
      config,
      path: 'websites/site-1/metrics/expanded',
      searchParams: expect.any(URLSearchParams),
    })
  })

  it('keeps typed parameters when filters include colliding keys', async () => {
    await executeUmamiMcpTool(config, 'get_website_stats', {
      websiteId: 'site-1',
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2026-01-02T00:00:00.000Z',
      compare: 'prev',
      filters: {
        event: 'signup',
        startAt: '999',
        compare: 'yoy',
      },
    })

    const [request] = umamiClientMocks.requestUmamiJson.mock.calls[0] as [{
      searchParams: URLSearchParams
    }]
    expect(request.searchParams.toString()).toBe(
      'startAt=1767225600000&endAt=1767312000000&compare=prev&event=signup'
    )
  })

  it('uses the non-expanded metrics endpoint by default', async () => {
    await executeUmamiMcpTool(config, 'get_website_metrics', {
      websiteId: 'site-1',
      type: 'country',
      filters: {
        event: 'signup',
      },
    })

    const [request] = umamiClientMocks.requestUmamiJson.mock.calls[0] as [{
      path: string
      searchParams: URLSearchParams
    }]

    expect(request.path).toBe('websites/site-1/metrics')
    expect(request.searchParams.get('event')).toBe('signup')
  })

  it('escapes website identifiers before interpolating them into Umami paths', async () => {
    await executeUmamiMcpTool(config, 'get_realtime', {
      websiteId: '../../users',
    })

    const [request] = umamiClientMocks.requestUmamiJson.mock.calls[0] as [{
      path: string
    }]

    expect(request.path).toBe('realtime/..%2F..%2Fusers')
  })

  it('rejects missing website identifiers before calling Umami', async () => {
    const result = await executeUmamiMcpTool(config, 'get_realtime', {})

    expect(parseToolResult(result)).toEqual({
      ok: false,
      error: 'invalid_arguments',
      message: 'websiteId is required',
    })
    expect(result.isError).toBe(true)
    expect(umamiClientMocks.requestUmamiJson).not.toHaveBeenCalled()
  })
})

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

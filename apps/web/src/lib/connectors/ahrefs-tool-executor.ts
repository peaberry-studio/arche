import { getPositiveInteger, getString, isRecord } from '@/lib/connectors/connector-values'
import { requestAhrefsJson } from '@/lib/connectors/ahrefs-client'
import { AHREFS_MCP_TOOLS } from '@/lib/connectors/ahrefs-tool-definitions'
import type {
  AhrefsApiResponse,
  AhrefsConnectorConfig,
  AhrefsMcpToolResult,
} from '@/lib/connectors/ahrefs-types'

function toToolText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function toToolSuccess(value: unknown): AhrefsMcpToolResult {
  return {
    content: [{ type: 'text', text: toToolText(value) }],
  }
}

function toToolError(error: string, message: string, detail?: Record<string, unknown>): AhrefsMcpToolResult {
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

function buildSearchParams(args: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue
    params[key] = String(value)
  }
  return params
}

function mapAhrefsResponse(response: AhrefsApiResponse): AhrefsMcpToolResult {
  if (!response.ok) {
    return toToolError(
      response.error,
      response.message,
      response.retryAfter ? { retryAfter: response.retryAfter } : undefined
    )
  }

  return toToolSuccess(response.data)
}

export async function executeAhrefsMcpTool(
  config: AhrefsConnectorConfig,
  toolName: string,
  args: unknown
): Promise<AhrefsMcpToolResult> {
  const tool = AHREFS_MCP_TOOLS.find((entry) => entry.name === toolName)
  if (!tool) {
    return toToolError('tool_not_found', `Tool not found: ${toolName}`)
  }

  const params = isRecord(args) ? args : {}

  switch (toolName) {
    case 'get_domain_rating': {
      const target = getString(params.target)
      const date = getString(params.date)
      if (!target) return toToolError('invalid_arguments', 'target is required')
      if (!date) return toToolError('invalid_arguments', 'date is required')

      const response = await requestAhrefsJson({
        config,
        path: '/v3/site-explorer/domain-rating',
        searchParams: buildSearchParams({
          target,
          date,
          protocol: getString(params.protocol) ?? 'both',
        }),
      })
      return mapAhrefsResponse(response)
    }

    case 'get_site_metrics': {
      const target = getString(params.target)
      const date = getString(params.date)
      if (!target) return toToolError('invalid_arguments', 'target is required')
      if (!date) return toToolError('invalid_arguments', 'date is required')

      const response = await requestAhrefsJson({
        config,
        path: '/v3/site-explorer/metrics',
        searchParams: buildSearchParams({
          target,
          date,
          country: getString(params.country),
          protocol: getString(params.protocol) ?? 'both',
          mode: getString(params.mode) ?? 'subdomains',
        }),
      })
      return mapAhrefsResponse(response)
    }

    case 'get_backlinks': {
      const target = getString(params.target)
      if (!target) return toToolError('invalid_arguments', 'target is required')

      const limit = getPositiveInteger(params.limit) ?? 100
      const response = await requestAhrefsJson({
        config,
        path: '/v3/site-explorer/all-backlinks',
        searchParams: buildSearchParams({
          target,
          limit: Math.min(limit, 1000),
          select: getString(params.select) ?? 'url_from,url_to,domain_rating_source,url_rating_source,anchor',
          protocol: getString(params.protocol) ?? 'both',
          mode: getString(params.mode) ?? 'subdomains',
        }),
      })
      return mapAhrefsResponse(response)
    }

    case 'get_organic_keywords': {
      const target = getString(params.target)
      const date = getString(params.date)
      if (!target) return toToolError('invalid_arguments', 'target is required')
      if (!date) return toToolError('invalid_arguments', 'date is required')

      const limit = getPositiveInteger(params.limit) ?? 100
      const response = await requestAhrefsJson({
        config,
        path: '/v3/site-explorer/organic-keywords',
        searchParams: buildSearchParams({
          target,
          date,
          country: getString(params.country),
          limit: Math.min(limit, 1000),
          select:
            getString(params.select) ??
            'keyword,keyword_country,volume,keyword_difficulty,sum_traffic,cpc,best_position',
          protocol: getString(params.protocol) ?? 'both',
          mode: getString(params.mode) ?? 'subdomains',
        }),
      })
      return mapAhrefsResponse(response)
    }

    case 'get_top_pages': {
      const target = getString(params.target)
      const date = getString(params.date)
      if (!target) return toToolError('invalid_arguments', 'target is required')
      if (!date) return toToolError('invalid_arguments', 'date is required')

      const limit = getPositiveInteger(params.limit) ?? 100
      const response = await requestAhrefsJson({
        config,
        path: '/v3/site-explorer/top-pages',
        searchParams: buildSearchParams({
          target,
          date,
          country: getString(params.country),
          limit: Math.min(limit, 1000),
          select:
            getString(params.select) ??
            'url,sum_traffic,keywords,top_keyword,top_keyword_volume,referring_domains',
          protocol: getString(params.protocol) ?? 'both',
          mode: getString(params.mode) ?? 'subdomains',
        }),
      })
      return mapAhrefsResponse(response)
    }

    case 'get_keyword_overview': {
      const keywords = getString(params.keywords)
      if (!keywords) return toToolError('invalid_arguments', 'keywords is required')

      const response = await requestAhrefsJson({
        config,
        path: '/v3/keywords-explorer/overview',
        searchParams: buildSearchParams({
          keywords,
          country: getString(params.country) ?? 'us',
          select: getString(params.select) ?? 'keyword,volume,traffic_potential,difficulty,cpc,parent_topic',
        }),
      })
      return mapAhrefsResponse(response)
    }

    case 'get_serp_overview': {
      const keyword = getString(params.keyword)
      if (!keyword) return toToolError('invalid_arguments', 'keyword is required')

      const response = await requestAhrefsJson({
        config,
        path: '/v3/serp-overview/serp-overview',
        searchParams: buildSearchParams({
          keyword,
          country: getString(params.country) ?? 'us',
          date: getString(params.date),
          top_positions: getPositiveInteger(params.top_positions),
          select: getString(params.select) ?? 'url,position,title,domain_rating,backlinks,traffic,url_rating',
        }),
      })
      return mapAhrefsResponse(response)
    }

    case 'get_subscription_limits': {
      const response = await requestAhrefsJson({
        config,
        path: '/v3/subscription-info/limits-and-usage',
      })
      return mapAhrefsResponse(response)
    }

    default:
      return toToolError('tool_not_found', `Tool not found: ${toolName}`)
  }
}

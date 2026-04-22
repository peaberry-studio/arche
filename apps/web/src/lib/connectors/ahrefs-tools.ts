import type {
  AhrefsApiResponse,
  AhrefsConnectorConfig,
  AhrefsMcpTool,
  AhrefsMcpToolResult,
} from '@/lib/connectors/ahrefs-types'
import { requestAhrefsJson } from '@/lib/connectors/ahrefs-client'

const AHREFS_MCP_TOOLS: AhrefsMcpTool[] = [
  {
    name: 'get_domain_rating',
    description: 'Get the Domain Rating (DR) and Ahrefs Rank for a target domain or URL.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The target domain or URL.',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format. Defaults to the most recent available date.',
        },
        protocol: {
          type: 'string',
          enum: ['both', 'http', 'https'],
          description: 'Protocol filter.',
        },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_site_metrics',
    description: 'Get organic and paid search metrics for a target (keywords, traffic, cost).',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The target domain or URL.',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format. Defaults to the most recent available date.',
        },
        country: {
          type: 'string',
          description: 'Two-letter country code (ISO 3166-1 alpha-2).',
        },
        protocol: {
          type: 'string',
          enum: ['both', 'http', 'https'],
          description: 'Protocol filter.',
        },
        mode: {
          type: 'string',
          enum: ['exact', 'prefix', 'domain', 'subdomains'],
          description: 'Scope of the target. Defaults to subdomains.',
        },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_backlinks',
    description: 'Get backlinks pointing to a target domain or URL.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The target domain or URL.',
        },
        limit: {
          type: 'integer',
          description: 'Number of results to return. Defaults to 100, max 1000.',
          minimum: 1,
          maximum: 1000,
        },
        select: {
          type: 'string',
          description: 'Comma-separated list of columns to return.',
        },
        protocol: {
          type: 'string',
          enum: ['both', 'http', 'https'],
          description: 'Protocol filter.',
        },
        mode: {
          type: 'string',
          enum: ['exact', 'prefix', 'domain', 'subdomains'],
          description: 'Scope of the target. Defaults to subdomains.',
        },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_organic_keywords',
    description: 'Get organic keywords that a target domain or URL ranks for.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The target domain or URL.',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format. Defaults to the most recent available date.',
        },
        country: {
          type: 'string',
          description: 'Two-letter country code (ISO 3166-1 alpha-2).',
        },
        limit: {
          type: 'integer',
          description: 'Number of results to return. Defaults to 100, max 1000.',
          minimum: 1,
          maximum: 1000,
        },
        select: {
          type: 'string',
          description: 'Comma-separated list of columns to return.',
        },
        protocol: {
          type: 'string',
          enum: ['both', 'http', 'https'],
          description: 'Protocol filter.',
        },
        mode: {
          type: 'string',
          enum: ['exact', 'prefix', 'domain', 'subdomains'],
          description: 'Scope of the target. Defaults to subdomains.',
        },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_top_pages',
    description: 'Get the top-performing pages of a target domain by organic traffic.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'The target domain or URL.',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format. Defaults to the most recent available date.',
        },
        country: {
          type: 'string',
          description: 'Two-letter country code (ISO 3166-1 alpha-2).',
        },
        limit: {
          type: 'integer',
          description: 'Number of results to return. Defaults to 100, max 1000.',
          minimum: 1,
          maximum: 1000,
        },
        select: {
          type: 'string',
          description: 'Comma-separated list of columns to return.',
        },
        protocol: {
          type: 'string',
          enum: ['both', 'http', 'https'],
          description: 'Protocol filter.',
        },
        mode: {
          type: 'string',
          enum: ['exact', 'prefix', 'domain', 'subdomains'],
          description: 'Scope of the target. Defaults to subdomains.',
        },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_keyword_overview',
    description: 'Get metrics for one or more keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        keywords: {
          type: 'string',
          description: 'Comma-separated list of keywords.',
        },
        country: {
          type: 'string',
          description: 'Two-letter country code (ISO 3166-1 alpha-2). Defaults to us.',
        },
        select: {
          type: 'string',
          description: 'Comma-separated list of columns to return.',
        },
      },
      required: ['keywords'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_serp_overview',
    description: 'Get the top 100 SERP results for a keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'The keyword to get SERP overview for.',
        },
        country: {
          type: 'string',
          description: 'Two-letter country code (ISO 3166-1 alpha-2). Defaults to us.',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DDThh:mm:ss format. Defaults to most recent.',
        },
        top_positions: {
          type: 'integer',
          description: 'Number of top organic positions to return.',
          minimum: 1,
        },
        select: {
          type: 'string',
          description: 'Comma-separated list of columns to return.',
        },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_subscription_limits',
    description: 'Get Ahrefs API subscription limits and current usage. This does not consume API units.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
]

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isInteger(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0 && Number.isInteger(parsed)) {
      return parsed
    }
  }
  return undefined
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

export function getAhrefsMcpTools(): AhrefsMcpTool[] {
  return AHREFS_MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

export async function executeAhrefsMcpTool(
  config: AhrefsConnectorConfig,
  toolName: string,
  args: unknown
): Promise<AhrefsMcpToolResult> {
  const tool = AHREFS_MCP_TOOLS.find((t) => t.name === toolName)
  if (!tool) {
    return toToolError('tool_not_found', `Tool not found: ${toolName}`)
  }

  const params = isRecord(args) ? args : {}

  switch (toolName) {
    case 'get_domain_rating': {
      const target = getString(params.target)
      if (!target) {
        return toToolError('invalid_arguments', 'target is required')
      }
      const response = await requestAhrefsJson({
        config,
        path: '/v3/site-explorer/domain-rating',
        searchParams: buildSearchParams({
          target,
          date: getString(params.date),
          protocol: getString(params.protocol) ?? 'both',
        }),
      })
      return mapAhrefsResponse(response)
    }

    case 'get_site_metrics': {
      const target = getString(params.target)
      if (!target) {
        return toToolError('invalid_arguments', 'target is required')
      }
      const response = await requestAhrefsJson({
        config,
        path: '/v3/site-explorer/metrics',
        searchParams: buildSearchParams({
          target,
          date: getString(params.date),
          country: getString(params.country),
          protocol: getString(params.protocol) ?? 'both',
          mode: getString(params.mode) ?? 'subdomains',
        }),
      })
      return mapAhrefsResponse(response)
    }

    case 'get_backlinks': {
      const target = getString(params.target)
      if (!target) {
        return toToolError('invalid_arguments', 'target is required')
      }
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
      if (!target) {
        return toToolError('invalid_arguments', 'target is required')
      }
      const limit = getPositiveInteger(params.limit) ?? 100
      const response = await requestAhrefsJson({
        config,
        path: '/v3/site-explorer/organic-keywords',
        searchParams: buildSearchParams({
          target,
          date: getString(params.date),
          country: getString(params.country),
          limit: Math.min(limit, 1000),
          select:
            getString(params.select) ??
            'keyword,country,volume,keyword_difficulty,traffic,cpc,position',
          protocol: getString(params.protocol) ?? 'both',
          mode: getString(params.mode) ?? 'subdomains',
        }),
      })
      return mapAhrefsResponse(response)
    }

    case 'get_top_pages': {
      const target = getString(params.target)
      if (!target) {
        return toToolError('invalid_arguments', 'target is required')
      }
      const limit = getPositiveInteger(params.limit) ?? 100
      const response = await requestAhrefsJson({
        config,
        path: '/v3/site-explorer/top-pages',
        searchParams: buildSearchParams({
          target,
          date: getString(params.date),
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
      if (!keywords) {
        return toToolError('invalid_arguments', 'keywords is required')
      }
      const response = await requestAhrefsJson({
        config,
        path: '/v3/keywords-explorer/overview',
        searchParams: buildSearchParams({
          keywords,
          country: getString(params.country) ?? 'us',
          select:
            getString(params.select) ??
            'keyword,volume,traffic_potential,difficulty,cpc,parent_topic',
        }),
      })
      return mapAhrefsResponse(response)
    }

    case 'get_serp_overview': {
      const keyword = getString(params.keyword)
      if (!keyword) {
        return toToolError('invalid_arguments', 'keyword is required')
      }
      const response = await requestAhrefsJson({
        config,
        path: '/v3/serp-overview/serp-overview',
        searchParams: buildSearchParams({
          keyword,
          country: getString(params.country) ?? 'us',
          date: getString(params.date),
          top_positions: getPositiveInteger(params.top_positions),
          select:
            getString(params.select) ??
            'url,position,title,domain_rating,backlinks,traffic,url_rating',
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

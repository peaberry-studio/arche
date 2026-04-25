import type { AhrefsMcpTool } from '@/lib/connectors/ahrefs-types'

const AHREFS_MCP_PROTOCOL_VERSION = '2025-03-26'

export const AHREFS_MCP_TOOLS: AhrefsMcpTool[] = [
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
          description: 'Date in YYYY-MM-DD format.',
        },
        protocol: {
          type: 'string',
          enum: ['both', 'http', 'https'],
          description: 'Protocol filter.',
        },
      },
      required: ['target', 'date'],
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
          description: 'Date in YYYY-MM-DD format.',
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
      required: ['target', 'date'],
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
          description: 'Date in YYYY-MM-DD format.',
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
      required: ['target', 'date'],
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
          description: 'Date in YYYY-MM-DD format.',
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
      required: ['target', 'date'],
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

export function getAhrefsMcpProtocolVersion(): string {
  return AHREFS_MCP_PROTOCOL_VERSION
}

export function getAhrefsMcpTools(): AhrefsMcpTool[] {
  return AHREFS_MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

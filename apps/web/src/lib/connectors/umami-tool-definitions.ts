import type { UmamiMcpTool } from '@/lib/connectors/umami-types'

const UMAMI_MCP_PROTOCOL_VERSION = '2025-03-26'

export const DEFAULT_RANGE_MS = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_LIST_PAGE_SIZE = 20
export const MAX_LIST_PAGE_SIZE = 100
export const DEFAULT_METRIC_LIMIT = 100
export const MAX_METRIC_LIMIT = 500

export const METRIC_TYPES = [
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

export const TIME_UNITS = ['minute', 'hour', 'day', 'month', 'year'] as const

export type MetricsType = (typeof METRIC_TYPES)[number]
export type TimeUnit = (typeof TIME_UNITS)[number]

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

export function getUmamiMcpProtocolVersion(): string {
  return UMAMI_MCP_PROTOCOL_VERSION
}

export function getUmamiMcpTools(): UmamiMcpTool[] {
  return UMAMI_MCP_TOOLS.map((tool) => ({ ...tool }))
}

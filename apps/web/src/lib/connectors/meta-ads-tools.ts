import {
  getMetaAdsAccountInsights,
  getMetaAdsCampaignInsights,
  getMetaAdsObject,
  listMetaAdAccounts,
  listMetaAdsAdSets,
  listMetaAdsAds,
  listMetaAdsCampaigns,
} from '@/lib/connectors/meta-ads-client'
import { normalizeMetaAdsAccountId, parseMetaAdsConnectorConfig } from '@/lib/connectors/meta-ads-config'
import type {
  MetaAdsConnectorConfig,
  MetaAdsMcpTool,
  MetaAdsMcpToolResult,
} from '@/lib/connectors/meta-ads-types'
import { isRecord } from '@/lib/records'

const MAX_LIST_LIMIT = 100
const MAX_INSIGHTS_LIMIT = 100
const ALLOWED_DATE_PRESETS = [
  'today',
  'yesterday',
  'this_month',
  'last_month',
  'last_7d',
  'last_14d',
  'last_30d',
  'this_quarter',
  'last_quarter',
] as const

const META_ADS_MCP_TOOLS: MetaAdsMcpTool[] = [
  {
    name: 'list_ad_accounts',
    description: 'List the Meta ad accounts enabled for this workspace connector.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_campaigns',
    description: 'List campaigns for one enabled Meta ad account.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Meta ad account id. Optional when the connector has a default or only one selected account.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum campaigns to return. Defaults to 25, maximum 100.',
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_ad_sets',
    description: 'List ad sets for one enabled Meta ad account.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Meta ad account id. Optional when the connector has a default or only one selected account.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum ad sets to return. Defaults to 25, maximum 100.',
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_ads',
    description: 'List ads for one enabled Meta ad account.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Meta ad account id. Optional when the connector has a default or only one selected account.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum ads to return. Defaults to 25, maximum 100.',
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_account_insights',
    description: 'Fetch read-only insights metrics for one enabled Meta ad account.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Meta ad account id. Optional when the connector has a default or only one selected account.',
        },
        datePreset: {
          type: 'string',
          enum: [...ALLOWED_DATE_PRESETS],
          description: 'Preset date range. Defaults to last_30d when since/until are omitted.',
        },
        since: {
          type: 'string',
          description: 'Optional inclusive start date in YYYY-MM-DD format. Must be paired with until.',
        },
        until: {
          type: 'string',
          description: 'Optional inclusive end date in YYYY-MM-DD format. Must be paired with since.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum insights rows to return. Defaults to 25, maximum 100.',
          minimum: 1,
          maximum: MAX_INSIGHTS_LIMIT,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_campaign_insights',
    description: 'Fetch read-only insights metrics for a Meta campaign that belongs to an enabled ad account.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: {
          type: 'string',
          description: 'Meta campaign id.',
        },
        datePreset: {
          type: 'string',
          enum: [...ALLOWED_DATE_PRESETS],
          description: 'Preset date range. Defaults to last_30d when since/until are omitted.',
        },
        since: {
          type: 'string',
          description: 'Optional inclusive start date in YYYY-MM-DD format. Must be paired with until.',
        },
        until: {
          type: 'string',
          description: 'Optional inclusive end date in YYYY-MM-DD format. Must be paired with since.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum insights rows to return. Defaults to 25, maximum 100.',
          minimum: 1,
          maximum: MAX_INSIGHTS_LIMIT,
        },
      },
      required: ['campaignId'],
      additionalProperties: false,
    },
  },
]

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function toToolText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function toToolSuccess(value: unknown): MetaAdsMcpToolResult {
  return {
    content: [{ type: 'text', text: toToolText(value) }],
  }
}

function toToolError(error: string, message: string, detail?: Record<string, unknown>): MetaAdsMcpToolResult {
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

function requireObjectArguments(args: unknown): Record<string, unknown> {
  return isRecord(args) ? args : {}
}

function getOptionalLimit(args: Record<string, unknown>, max: number): number | undefined {
  const limit = getPositiveInteger(args.limit)
  if (limit === undefined) return undefined
  return Math.min(limit, max)
}

function validateDateRange(args: Record<string, unknown>): { ok: true; since?: string; until?: string } | { ok: false; message: string } {
  const since = getString(args.since)
  const until = getString(args.until)

  if (Boolean(since) !== Boolean(until)) {
    return { ok: false, message: 'since and until must be provided together' }
  }

  return { ok: true, since, until }
}

function getDatePreset(args: Record<string, unknown>): { ok: true; value: string } | { ok: false; message: string } {
  const value = getString(args.datePreset) ?? 'last_30d'
  if ((ALLOWED_DATE_PRESETS as readonly string[]).includes(value)) {
    return { ok: true, value }
  }

  return {
    ok: false,
    message: `datePreset must be one of: ${ALLOWED_DATE_PRESETS.join(', ')}`,
  }
}

function normalizeAllowedAccountIds(config: MetaAdsConnectorConfig): string[] {
  return config.selectedAdAccountIds
}

function resolveAccountId(
  config: MetaAdsConnectorConfig,
  accountIdInput: unknown
): { ok: true; accountId: string } | { ok: false; result: MetaAdsMcpToolResult } {
  const normalizedAllowedAccountIds = normalizeAllowedAccountIds(config)
  if (normalizedAllowedAccountIds.length === 0) {
    return {
      ok: false,
      result: toToolError('connector_not_ready', 'Select at least one Meta ad account in connector settings before using this tool.'),
    }
  }

  const requestedAccountId = typeof accountIdInput === 'string'
    ? normalizeMetaAdsAccountId(accountIdInput)
    : null

  if (requestedAccountId) {
    if (!normalizedAllowedAccountIds.includes(requestedAccountId)) {
      return {
        ok: false,
        result: toToolError('forbidden_account', `Meta ad account ${requestedAccountId} is not enabled for this workspace.`),
      }
    }

    return { ok: true, accountId: requestedAccountId }
  }

  if (config.defaultAdAccountId) {
    return { ok: true, accountId: config.defaultAdAccountId }
  }

  if (normalizedAllowedAccountIds.length === 1) {
    return { ok: true, accountId: normalizedAllowedAccountIds[0] }
  }

  return {
    ok: false,
    result: toToolError('missing_account', 'accountId is required when multiple Meta ad accounts are enabled for this workspace.'),
  }
}

async function verifyCampaignAccess(
  decryptedConfig: Record<string, unknown>,
  config: MetaAdsConnectorConfig,
  campaignId: string,
): Promise<{ ok: true; accountId: string; campaign: Record<string, unknown> } | { ok: false; result: MetaAdsMcpToolResult }> {
  const response = await getMetaAdsObject(decryptedConfig, campaignId, 'id,name,account_id')
  if (!response.ok) {
    return {
      ok: false,
      result: toToolError(response.error, response.message, { status: response.status }),
    }
  }

  const accountId = normalizeMetaAdsAccountId(String(response.data.account_id ?? ''))
  if (!accountId || !config.selectedAdAccountIds.includes(accountId)) {
    return {
      ok: false,
      result: toToolError('forbidden_campaign', `Campaign ${campaignId} does not belong to an enabled Meta ad account.`),
    }
  }

  return { ok: true, accountId, campaign: response.data }
}

export function getMetaAdsMcpProtocolVersion(): string {
  return '2025-03-26'
}

export function getMetaAdsMcpTools(config: MetaAdsConnectorConfig): MetaAdsMcpTool[] {
  if (!config.permissions.allowRead) {
    return []
  }

  return META_ADS_MCP_TOOLS
}

export async function executeMetaAdsMcpTool(
  decryptedConfig: Record<string, unknown>,
  toolName: string,
  args: unknown
): Promise<MetaAdsMcpToolResult> {
  const parsedConfig = parseMetaAdsConnectorConfig(decryptedConfig)
  if (!parsedConfig.ok) {
    return toToolError(
      'invalid_config',
      parsedConfig.message ?? `Missing required fields: ${parsedConfig.missing?.join(', ')}`
    )
  }

  if (!parsedConfig.value.permissions.allowRead) {
    return toToolError('forbidden', 'Meta Ads read access is disabled for this connector.')
  }

  const argumentsObject = requireObjectArguments(args)

  switch (toolName) {
    case 'list_ad_accounts': {
      const response = await listMetaAdAccounts(decryptedConfig)
      if (!response.ok) {
        return toToolError(response.error, response.message, { status: response.status })
      }

      return toToolSuccess({
        ok: true,
        adAccounts: response.data.items.filter((account) => parsedConfig.value.selectedAdAccountIds.includes(account.id)),
      })
    }

    case 'list_campaigns': {
      const resolvedAccountId = resolveAccountId(parsedConfig.value, argumentsObject.accountId)
      if (!resolvedAccountId.ok) {
        return resolvedAccountId.result
      }

      const response = await listMetaAdsCampaigns(
        decryptedConfig,
        resolvedAccountId.accountId,
        getOptionalLimit(argumentsObject, MAX_LIST_LIMIT) ?? 25,
      )
      if (!response.ok) {
        return toToolError(response.error, response.message, { status: response.status })
      }

      return toToolSuccess({
        ok: true,
        accountId: resolvedAccountId.accountId,
        campaigns: response.data.items,
        paging: response.data.paging,
      })
    }

    case 'list_ad_sets': {
      const resolvedAccountId = resolveAccountId(parsedConfig.value, argumentsObject.accountId)
      if (!resolvedAccountId.ok) {
        return resolvedAccountId.result
      }

      const response = await listMetaAdsAdSets(
        decryptedConfig,
        resolvedAccountId.accountId,
        getOptionalLimit(argumentsObject, MAX_LIST_LIMIT) ?? 25,
      )
      if (!response.ok) {
        return toToolError(response.error, response.message, { status: response.status })
      }

      return toToolSuccess({
        ok: true,
        accountId: resolvedAccountId.accountId,
        adSets: response.data.items,
        paging: response.data.paging,
      })
    }

    case 'list_ads': {
      const resolvedAccountId = resolveAccountId(parsedConfig.value, argumentsObject.accountId)
      if (!resolvedAccountId.ok) {
        return resolvedAccountId.result
      }

      const response = await listMetaAdsAds(
        decryptedConfig,
        resolvedAccountId.accountId,
        getOptionalLimit(argumentsObject, MAX_LIST_LIMIT) ?? 25,
      )
      if (!response.ok) {
        return toToolError(response.error, response.message, { status: response.status })
      }

      return toToolSuccess({
        ok: true,
        accountId: resolvedAccountId.accountId,
        ads: response.data.items,
        paging: response.data.paging,
      })
    }

    case 'get_account_insights': {
      const resolvedAccountId = resolveAccountId(parsedConfig.value, argumentsObject.accountId)
      if (!resolvedAccountId.ok) {
        return resolvedAccountId.result
      }

      const datePreset = getDatePreset(argumentsObject)
      if (!datePreset.ok) {
        return toToolError('invalid_arguments', datePreset.message)
      }

      const dateRange = validateDateRange(argumentsObject)
      if (!dateRange.ok) {
        return toToolError('invalid_arguments', dateRange.message)
      }

      const response = await getMetaAdsAccountInsights(decryptedConfig, resolvedAccountId.accountId, {
        datePreset: dateRange.since ? undefined : datePreset.value,
        since: dateRange.since,
        until: dateRange.until,
        limit: getOptionalLimit(argumentsObject, MAX_INSIGHTS_LIMIT) ?? 25,
      })
      if (!response.ok) {
        return toToolError(response.error, response.message, { status: response.status })
      }

      return toToolSuccess({
        ok: true,
        accountId: resolvedAccountId.accountId,
        insights: response.data.items,
        paging: response.data.paging,
      })
    }

    case 'get_campaign_insights': {
      const campaignId = getString(argumentsObject.campaignId)
      if (!campaignId) {
        return toToolError('invalid_arguments', 'campaignId is required')
      }

      const datePreset = getDatePreset(argumentsObject)
      if (!datePreset.ok) {
        return toToolError('invalid_arguments', datePreset.message)
      }

      const dateRange = validateDateRange(argumentsObject)
      if (!dateRange.ok) {
        return toToolError('invalid_arguments', dateRange.message)
      }

      const access = await verifyCampaignAccess(decryptedConfig, parsedConfig.value, campaignId)
      if (!access.ok) {
        return access.result
      }

      const response = await getMetaAdsCampaignInsights(decryptedConfig, campaignId, {
        datePreset: dateRange.since ? undefined : datePreset.value,
        since: dateRange.since,
        until: dateRange.until,
        limit: getOptionalLimit(argumentsObject, MAX_INSIGHTS_LIMIT) ?? 25,
      })
      if (!response.ok) {
        return toToolError(response.error, response.message, { status: response.status })
      }

      return toToolSuccess({
        ok: true,
        accountId: access.accountId,
        campaign: access.campaign,
        insights: response.data.items,
        paging: response.data.paging,
      })
    }

    default:
      return toToolError('method_not_found', `Unknown Meta Ads tool: ${toolName}`)
  }
}

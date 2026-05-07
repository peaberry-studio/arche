import { getConnectorOAuthConfig } from '@/lib/connectors/oauth-config'
import { parseMetaAdsConnectorConfig } from '@/lib/connectors/meta-ads-config'
import { getMetaAdsGraphApiBaseUrl } from '@/lib/connectors/meta-ads-shared'
import type {
  MetaAdsAdAccount,
  MetaAdsApiResponse,
  MetaAdsListResult,
} from '@/lib/connectors/meta-ads-types'
import { isRecord } from '@/lib/records'

type MetaAdsInsightsRequest = {
  datePreset?: string
  since?: string
  until?: string
  limit?: number
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after')
  if (!raw) return undefined

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function getMetaAdsAccessToken(config: Record<string, unknown>): string | null {
  return getConnectorOAuthConfig('meta-ads', config)?.accessToken ?? null
}

function buildMetaAdsUrl(path: string, params?: Record<string, string | undefined>): string {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  const url = new URL(`${getMetaAdsGraphApiBaseUrl()}/${normalizedPath}`)

  for (const [key, value] of Object.entries(params ?? {})) {
    if (!value) continue
    url.searchParams.set(key, value)
  }

  return url.toString()
}

function buildTimeRange(since?: string, until?: string): string | undefined {
  if (!since || !until) return undefined
  return JSON.stringify({ since, until })
}

function parsePaging(value: unknown): MetaAdsListResult<unknown>['paging'] {
  if (!isRecord(value)) return undefined

  const next = getString(value.next)
  const previous = getString(value.previous)
  if (!next && !previous) return undefined

  return { next, previous }
}

function parseMetaAdsApiError(response: Response, data: unknown): MetaAdsApiResponse<never> {
  const errorRecord = isRecord(data) && isRecord(data.error) ? data.error : null
  const errorMessage = getString(errorRecord?.message)
  const errorCode = getString(errorRecord?.code) ?? String(getFiniteNumber(errorRecord?.code) ?? 'meta_ads_request_failed')

  return {
    ok: false,
    error: errorCode,
    message: errorMessage ?? `Meta Ads request failed (${response.status})`,
    status: response.status,
    headers: response.headers,
    data,
    retryAfter: getRetryAfter(response.headers),
  }
}

async function requestMetaAdsJson(
  config: Record<string, unknown>,
  path: string,
  params?: Record<string, string | undefined>
): Promise<MetaAdsApiResponse<Record<string, unknown>>> {
  const parsedConfig = parseMetaAdsConnectorConfig(config)
  if (!parsedConfig.ok) {
    return {
      ok: false,
      error: 'invalid_config',
      message: parsedConfig.message ?? `Missing required fields: ${parsedConfig.missing?.join(', ')}`,
      status: 400,
    }
  }

  const accessToken = getMetaAdsAccessToken(config)
  if (!accessToken) {
    return {
      ok: false,
      error: 'not_authenticated',
      message: 'Meta Ads connector is not authenticated.',
      status: 401,
    }
  }

  const response = await fetch(buildMetaAdsUrl(path, params), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  }).catch(() => null)

  if (!response) {
    return {
      ok: false,
      error: 'network_error',
      message: 'Meta Ads request failed before reaching the API.',
      status: 502,
    }
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok || !data) {
    return parseMetaAdsApiError(response, data)
  }

  if (isRecord(data.error)) {
    return parseMetaAdsApiError(response, data)
  }

  return {
    ok: true,
    data,
    status: response.status,
    headers: response.headers,
  }
}

function mapMetaAdsAdAccount(value: unknown): MetaAdsAdAccount | null {
  if (!isRecord(value)) return null

  const id = getString(value.id)
  const accountId = getString(value.account_id)
  const name = getString(value.name)
  if (!id || !accountId || !name) {
    return null
  }

  return {
    id,
    accountId,
    name,
    accountStatus: getFiniteNumber(value.account_status),
    currency: getString(value.currency),
    timezoneName: getString(value.timezone_name),
  }
}

function mapListResult<T>(data: Record<string, unknown>, mapper: (value: unknown) => T | null): MetaAdsListResult<T> {
  const items = Array.isArray(data.data)
    ? data.data.map((entry) => mapper(entry)).filter((entry): entry is T => Boolean(entry))
    : []

  return {
    items,
    paging: parsePaging(data.paging),
  }
}

function mapRecordListResult(data: Record<string, unknown>): MetaAdsListResult<Record<string, unknown>> {
  return {
    items: Array.isArray(data.data)
      ? data.data.filter((entry): entry is Record<string, unknown> => isRecord(entry))
      : [],
    paging: parsePaging(data.paging),
  }
}

export async function listMetaAdAccounts(
  config: Record<string, unknown>
): Promise<MetaAdsApiResponse<MetaAdsListResult<MetaAdsAdAccount>>> {
  const response = await requestMetaAdsJson(config, 'me/adaccounts', {
    fields: 'id,account_id,name,account_status,currency,timezone_name',
    limit: '500',
  })
  if (!response.ok) {
    return response
  }

  return {
    ok: true,
    data: mapListResult(response.data, mapMetaAdsAdAccount),
    status: response.status,
    headers: response.headers,
  }
}

export async function getMetaAdsObject(
  config: Record<string, unknown>,
  objectId: string,
  fields: string
): Promise<MetaAdsApiResponse<Record<string, unknown>>> {
  return requestMetaAdsJson(config, objectId, { fields })
}

export async function listMetaAdsCampaigns(
  config: Record<string, unknown>,
  accountId: string,
  limit = 25
): Promise<MetaAdsApiResponse<MetaAdsListResult<Record<string, unknown>>>> {
  const response = await requestMetaAdsJson(config, `${accountId}/campaigns`, {
    fields: 'id,name,objective,status,effective_status',
    limit: String(limit),
  })
  if (!response.ok) {
    return response
  }

  return {
    ok: true,
    data: mapRecordListResult(response.data),
    status: response.status,
    headers: response.headers,
  }
}

export async function listMetaAdsAdSets(
  config: Record<string, unknown>,
  accountId: string,
  limit = 25
): Promise<MetaAdsApiResponse<MetaAdsListResult<Record<string, unknown>>>> {
  const response = await requestMetaAdsJson(config, `${accountId}/adsets`, {
    fields: 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,start_time,end_time',
    limit: String(limit),
  })
  if (!response.ok) {
    return response
  }

  return {
    ok: true,
    data: mapRecordListResult(response.data),
    status: response.status,
    headers: response.headers,
  }
}

export async function listMetaAdsAds(
  config: Record<string, unknown>,
  accountId: string,
  limit = 25
): Promise<MetaAdsApiResponse<MetaAdsListResult<Record<string, unknown>>>> {
  const response = await requestMetaAdsJson(config, `${accountId}/ads`, {
    fields: 'id,name,adset_id,campaign_id,status,effective_status',
    limit: String(limit),
  })
  if (!response.ok) {
    return response
  }

  return {
    ok: true,
    data: mapRecordListResult(response.data),
    status: response.status,
    headers: response.headers,
  }
}

export async function getMetaAdsAccountInsights(
  config: Record<string, unknown>,
  accountId: string,
  request: MetaAdsInsightsRequest
): Promise<MetaAdsApiResponse<MetaAdsListResult<Record<string, unknown>>>> {
  const response = await requestMetaAdsJson(config, `${accountId}/insights`, {
    fields: 'account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,reach,clicks,spend,ctr,cpc,cpm,actions,cost_per_action_type,date_start,date_stop',
    date_preset: request.datePreset,
    time_range: buildTimeRange(request.since, request.until),
    limit: request.limit ? String(request.limit) : undefined,
  })
  if (!response.ok) {
    return response
  }

  return {
    ok: true,
    data: mapRecordListResult(response.data),
    status: response.status,
    headers: response.headers,
  }
}

export async function getMetaAdsCampaignInsights(
  config: Record<string, unknown>,
  campaignId: string,
  request: MetaAdsInsightsRequest
): Promise<MetaAdsApiResponse<MetaAdsListResult<Record<string, unknown>>>> {
  const response = await requestMetaAdsJson(config, `${campaignId}/insights`, {
    fields: 'account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,reach,clicks,spend,ctr,cpc,cpm,actions,cost_per_action_type,date_start,date_stop',
    date_preset: request.datePreset,
    time_range: buildTimeRange(request.since, request.until),
    limit: request.limit ? String(request.limit) : undefined,
  })
  if (!response.ok) {
    return response
  }

  return {
    ok: true,
    data: mapRecordListResult(response.data),
    status: response.status,
    headers: response.headers,
  }
}

export async function testMetaAdsConnection(
  config: Record<string, unknown>
): Promise<{ ok: boolean; message: string }> {
  const response = await listMetaAdAccounts(config)
  if (!response.ok) {
    return {
      ok: false,
      message: response.message,
    }
  }

  return {
    ok: true,
    message: `Meta Ads connection verified. Accessible ad accounts: ${response.data.items.length}.`,
  }
}

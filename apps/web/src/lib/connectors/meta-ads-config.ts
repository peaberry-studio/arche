import type { ConnectorConfigValidationResult } from '@/lib/connectors/config-validation'
import {
  DEFAULT_META_ADS_CONNECTOR_PERMISSIONS,
  META_ADS_CONNECTOR_PERMISSION_KEYS,
  type MetaAdsConnectorConfig,
  type MetaAdsConnectorPermissions,
} from '@/lib/connectors/meta-ads-types'
import { isRecord } from '@/lib/records'

type ParsedMetaAdsConnectorPermissions =
  | { ok: true; value: MetaAdsConnectorPermissions }
  | { ok: false; message: string }

type ParsedMetaAdsAccountIds =
  | { ok: true; value: string[] }
  | { ok: false; message: string }

type ParsedMetaAdsConnectorConfig =
  | { ok: true; value: MetaAdsConnectorConfig }
  | { ok: false; missing?: string[]; message?: string }

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeMetaAdsAccountId(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^act_\d+$/.test(trimmed)) {
    return trimmed
  }

  if (/^\d+$/.test(trimmed)) {
    return `act_${trimmed}`
  }

  return null
}

export function parseMetaAdsConnectorPermissions(
  value: unknown,
  options?: { requireAll: boolean }
): ParsedMetaAdsConnectorPermissions {
  if (value === undefined) {
    if (options?.requireAll) {
      return { ok: false, message: 'permissions is required' }
    }

    return { ok: true, value: { ...DEFAULT_META_ADS_CONNECTOR_PERMISSIONS } }
  }

  if (!isRecord(value)) {
    return { ok: false, message: 'permissions must be an object' }
  }

  const permissions: MetaAdsConnectorPermissions = { ...DEFAULT_META_ADS_CONNECTOR_PERMISSIONS }

  for (const key of META_ADS_CONNECTOR_PERMISSION_KEYS) {
    if (!(key in value)) {
      if (options?.requireAll) {
        return { ok: false, message: `${key} is required` }
      }

      continue
    }

    const parsed = getBoolean(value[key])
    if (parsed === undefined) {
      return { ok: false, message: `${key} must be a boolean` }
    }

    permissions[key] = parsed
  }

  return { ok: true, value: permissions }
}

export function parseMetaAdsSelectedAdAccountIds(value: unknown): ParsedMetaAdsAccountIds {
  if (value === undefined) {
    return { ok: true, value: [] }
  }

  if (!Array.isArray(value)) {
    return { ok: false, message: 'selectedAdAccountIds must be an array' }
  }

  const ids: string[] = []

  for (const entry of value) {
    if (typeof entry !== 'string') {
      return { ok: false, message: 'selectedAdAccountIds must contain only strings' }
    }

    const normalized = normalizeMetaAdsAccountId(entry)
    if (!normalized) {
      return { ok: false, message: `Invalid ad account id: ${entry}` }
    }

    if (!ids.includes(normalized)) {
      ids.push(normalized)
    }
  }

  return { ok: true, value: ids }
}

function parseMetaAdsConnectorFields(config: Record<string, unknown>): ParsedMetaAdsConnectorConfig {
  if (config.authType !== 'oauth') {
    return { ok: false, message: 'Meta Ads connectors require OAuth' }
  }

  const appId = getString(config.appId)
  const appSecret = getString(config.appSecret)

  const missing = [
    ...(appId ? [] : ['appId']),
    ...(appSecret ? [] : ['appSecret']),
  ]

  if (!appId || !appSecret) {
    return { ok: false, missing }
  }

  const permissions = parseMetaAdsConnectorPermissions(config.permissions)
  if (!permissions.ok) {
    return permissions
  }

  const selectedAdAccountIds = parseMetaAdsSelectedAdAccountIds(config.selectedAdAccountIds)
  if (!selectedAdAccountIds.ok) {
    return selectedAdAccountIds
  }

  const defaultAdAccountIdInput = config.defaultAdAccountId
  let defaultAdAccountId: string | undefined
  if (defaultAdAccountIdInput !== undefined && defaultAdAccountIdInput !== null) {
    if (typeof defaultAdAccountIdInput !== 'string') {
      return { ok: false, message: 'defaultAdAccountId must be a string' }
    }

    const normalizedDefaultAdAccountId = normalizeMetaAdsAccountId(defaultAdAccountIdInput)
    if (!normalizedDefaultAdAccountId) {
      return { ok: false, message: 'defaultAdAccountId must be a valid Meta ad account id' }
    }

    defaultAdAccountId = normalizedDefaultAdAccountId
  }

  if (defaultAdAccountId && !selectedAdAccountIds.value.includes(defaultAdAccountId)) {
    return { ok: false, message: 'defaultAdAccountId must match one of the selected ad accounts' }
  }

  return {
    ok: true,
    value: {
      authType: 'oauth',
      appId,
      appSecret,
      permissions: permissions.value,
      selectedAdAccountIds: selectedAdAccountIds.value,
      defaultAdAccountId,
    },
  }
}

export function validateMetaAdsConnectorConfig(
  config: Record<string, unknown>
): ConnectorConfigValidationResult {
  const parsed = parseMetaAdsConnectorFields(config)
  if (!parsed.ok) {
    return {
      valid: false,
      missing: parsed.missing,
      message: parsed.message,
    }
  }

  return { valid: true }
}

export function parseMetaAdsConnectorConfig(
  config: Record<string, unknown>
): ParsedMetaAdsConnectorConfig {
  return parseMetaAdsConnectorFields(config)
}

export function isMetaAdsConnectorReady(config: Record<string, unknown>): boolean {
  const parsed = parseMetaAdsConnectorConfig(config)
  return parsed.ok && parsed.value.permissions.allowRead && parsed.value.selectedAdAccountIds.length > 0
}

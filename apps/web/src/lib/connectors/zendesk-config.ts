import type { ConnectorConfigValidationResult } from '@/lib/connectors/config-validation'
import { normalizeZendeskSubdomain } from '@/lib/connectors/zendesk-shared'
import {
  DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS,
  ZENDESK_CONNECTOR_PERMISSION_KEYS,
  type ZendeskConnectorConfig,
  type ZendeskConnectorPermissions,
} from '@/lib/connectors/zendesk-types'
import { getBoolean, getString, isRecord } from '@/lib/connectors/zendesk-values'

type ParsedZendeskConnectorConfig =
  | { ok: true; value: ZendeskConnectorConfig }
  | { ok: false; missing?: string[]; message?: string }

type ParsedZendeskConnectorPermissions =
  | { ok: true; value: ZendeskConnectorPermissions }
  | { ok: false; message: string }

export function getZendeskConnectorPermissionsConstraintMessage(
  permissions: ZendeskConnectorPermissions
): string | null {
  if (
    permissions.allowCreateTickets &&
    !permissions.allowPublicComments &&
    !permissions.allowInternalComments
  ) {
    return 'Ticket creation requires public comments or internal notes to stay enabled.'
  }

  return null
}

function isValidZendeskSubdomain(subdomain: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)
}

export function parseZendeskConnectorPermissions(
  value: unknown,
  options?: { requireAll: boolean }
): ParsedZendeskConnectorPermissions {
  if (value === undefined) {
    if (options?.requireAll) {
      return { ok: false, message: 'permissions is required' }
    }

    return { ok: true, value: { ...DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS } }
  }

  if (!isRecord(value)) {
    return { ok: false, message: 'permissions must be an object' }
  }

  const permissions: ZendeskConnectorPermissions = { ...DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS }

  for (const key of ZENDESK_CONNECTOR_PERMISSION_KEYS) {
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

function parseZendeskConnectorFields(config: Record<string, unknown>): ParsedZendeskConnectorConfig {
  const subdomainInput = getString(config.subdomain)
  const email = getString(config.email)
  const apiToken = getString(config.apiToken)

  const missing = [
    ...(subdomainInput ? [] : ['subdomain']),
    ...(email ? [] : ['email']),
    ...(apiToken ? [] : ['apiToken']),
  ]
  if (!subdomainInput || !email || !apiToken) {
    return { ok: false, missing }
  }

  const subdomain = normalizeZendeskSubdomain(subdomainInput)
  if (!isValidZendeskSubdomain(subdomain)) {
    return {
      ok: false,
      message: 'Subdomain must be a valid Zendesk subdomain or hostname.',
    }
  }

  const permissions = parseZendeskConnectorPermissions(config.permissions)
  if (!permissions.ok) {
    return permissions
  }

  return {
    ok: true,
    value: {
      subdomain,
      email,
      apiToken,
      permissions: permissions.value,
    },
  }
}

export function validateZendeskConnectorConfig(
  config: Record<string, unknown>
): ConnectorConfigValidationResult {
  const parsed = parseZendeskConnectorFields(config)
  if (!parsed.ok) {
    return {
      valid: false,
      missing: parsed.missing,
      message: parsed.message,
    }
  }

  const permissionsMessage = getZendeskConnectorPermissionsConstraintMessage(
    parsed.value.permissions
  )
  if (permissionsMessage) {
    return {
      valid: false,
      message: permissionsMessage,
    }
  }

  return { valid: true }
}

export function parseZendeskConnectorConfig(
  config: Record<string, unknown>
): ParsedZendeskConnectorConfig {
  return parseZendeskConnectorFields(config)
}

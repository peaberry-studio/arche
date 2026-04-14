import type { ConnectorConfigValidationResult } from '@/lib/connectors/config-validation'
import { normalizeZendeskSubdomain } from '@/lib/connectors/zendesk-shared'
import type { ZendeskConnectorConfig } from '@/lib/connectors/zendesk-types'
import { getString } from '@/lib/connectors/zendesk-values'

type ParsedZendeskConnectorConfig =
  | { ok: true; value: ZendeskConnectorConfig }
  | { ok: false; missing?: string[]; message?: string }

function isValidZendeskSubdomain(subdomain: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)
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
  if (missing.length > 0) {
    return { ok: false, missing }
  }

  const subdomain = normalizeZendeskSubdomain(subdomainInput)
  if (!isValidZendeskSubdomain(subdomain)) {
    return {
      ok: false,
      message: 'Subdomain must be a valid Zendesk subdomain or hostname.',
    }
  }

  return {
    ok: true,
    value: {
      subdomain,
      email,
      apiToken,
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

  return { valid: true }
}

export function parseZendeskConnectorConfig(
  config: Record<string, unknown>
): ParsedZendeskConnectorConfig {
  return parseZendeskConnectorFields(config)
}

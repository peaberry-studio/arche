import type { ConnectorConfigValidationResult } from '@/lib/connectors/config-validation'
import type { AhrefsConnectorConfig } from '@/lib/connectors/ahrefs-types'

type ParsedAhrefsConnectorConfig =
  | { ok: true; value: AhrefsConnectorConfig }
  | { ok: false; missing?: string[]; message?: string }

export function parseAhrefsConnectorConfig(
  config: Record<string, unknown>
): ParsedAhrefsConnectorConfig {
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''

  if (!apiKey) {
    return { ok: false, missing: ['apiKey'] }
  }

  return { ok: true, value: { apiKey } }
}

export function validateAhrefsConnectorConfig(
  config: Record<string, unknown>
): ConnectorConfigValidationResult {
  const parsed = parseAhrefsConnectorConfig(config)
  if (!parsed.ok) {
    return { valid: false, missing: parsed.missing, message: parsed.message }
  }

  return { valid: true }
}

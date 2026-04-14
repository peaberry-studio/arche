import { getConnectorAuthType } from '@/lib/connectors/oauth-config'
import { isOAuthConnectorType } from '@/lib/connectors/oauth'
import type { ConnectorConfigValidationResult } from '@/lib/connectors/config-validation'
import { validateZendeskConnectorConfig } from '@/lib/connectors/zendesk-config'

import { CONNECTOR_TYPES, type ConnectorType } from './types'

export { getConnectorAuthType } from '@/lib/connectors/oauth-config'
export { isOAuthConnectorType } from '@/lib/connectors/oauth'

export const MAX_CONNECTOR_NAME_LENGTH = 100

export interface ConnectorConfigSchema {
  required: string[]
  optional?: string[]
}

export type { ConnectorConfigValidationResult } from '@/lib/connectors/config-validation'

export const CONNECTOR_SCHEMAS: Record<ConnectorType, ConnectorConfigSchema> = {
  linear: { required: ['apiKey'] },
  notion: { required: ['apiKey'] },
  zendesk: { required: ['subdomain', 'email', 'apiToken'] },
  custom: {
    required: ['endpoint'],
    optional: [
      'headers',
      'auth',
      'oauthScope',
      'oauthClientId',
      'oauthClientSecret',
      'oauthAuthorizationEndpoint',
      'oauthTokenEndpoint',
      'oauthRegistrationEndpoint',
    ],
  },
}

export function validateConnectorType(type: string): type is ConnectorType {
  return CONNECTOR_TYPES.includes(type as ConnectorType)
}

export function validateConnectorName(name: unknown): { valid: boolean; error?: string } {
  if (typeof name !== 'string') {
    return { valid: false, error: 'Name must be a string' }
  }
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return { valid: false, error: 'Name cannot be empty' }
  }
  if (trimmed.length > MAX_CONNECTOR_NAME_LENGTH) {
    return { valid: false, error: `Name exceeds maximum length of ${MAX_CONNECTOR_NAME_LENGTH}` }
  }
  return { valid: true }
}

/**
 * Checks if a config value is valid (non-null, non-undefined, non-empty string).
 */
function isValidConfigValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string' && value.trim() === '') return false
  return true
}

export function validateConnectorConfig(
  type: ConnectorType,
  config: Record<string, unknown>
): ConnectorConfigValidationResult {
  if (getConnectorAuthType(config) === 'oauth' && isOAuthConnectorType(type)) {
    if (type === 'custom') {
      return isValidConfigValue(config.endpoint)
        ? { valid: true }
        : { valid: false, missing: ['endpoint'] }
    }

    return { valid: true }
  }

  if (type === 'zendesk') {
    if (getConnectorAuthType(config) === 'oauth') {
      return { valid: false, message: 'Zendesk connectors do not support OAuth' }
    }

    return validateZendeskConnectorConfig(config)
  }

  const schema = CONNECTOR_SCHEMAS[type]
  const missing = schema.required.filter((key) => !isValidConfigValue(config[key]))
  return missing.length === 0 ? { valid: true } : { valid: false, missing }
}

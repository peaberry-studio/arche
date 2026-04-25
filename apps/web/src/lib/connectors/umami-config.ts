import { getString } from '@/lib/connectors/connector-values'
import type { ConnectorConfigValidationResult } from '@/lib/connectors/config-validation'
import type { UmamiAuthMethod, UmamiConnectorConfig } from '@/lib/connectors/umami-types'

type ParsedUmamiConnectorConfig =
  | { ok: true; value: UmamiConnectorConfig }
  | { ok: false; missing?: string[]; message?: string }

function getAuthMethod(value: unknown): UmamiAuthMethod | null {
  return value === 'api-key' || value === 'login' ? value : null
}

export function normalizeUmamiBaseUrl(rawBaseUrl: string, authMethod: UmamiAuthMethod): string {
  let url: URL
  try {
    url = new URL(rawBaseUrl.trim())
  } catch {
    throw new Error('Base URL must be a valid HTTPS URL.')
  }

  if (url.protocol !== 'https:') {
    throw new Error('Base URL must be a valid HTTPS URL.')
  }

  if (url.username || url.password) {
    throw new Error('Base URL cannot include embedded credentials.')
  }

  url.search = ''
  url.hash = ''

  const pathname = url.pathname.replace(/\/+$/, '')
  if (authMethod === 'login') {
    if (!pathname || pathname === '/') {
      url.pathname = '/api'
    } else {
      url.pathname = pathname.endsWith('/api') ? pathname : `${pathname}/api`
    }
  } else if (!pathname || pathname === '/') {
    url.pathname = '/v1'
  } else {
    url.pathname = pathname
  }

  return url.toString()
}

export function parseUmamiConnectorConfig(
  config: Record<string, unknown>
): ParsedUmamiConnectorConfig {
  const authMethod = getAuthMethod(config.authMethod)
  if (!authMethod) {
    return {
      ok: false,
      message: 'Authentication method must be either api-key or login.',
    }
  }

  const rawBaseUrl = getString(config.baseUrl)
  if (!rawBaseUrl) {
    return {
      ok: false,
      missing: ['baseUrl'],
    }
  }

  let baseUrl: string
  try {
    baseUrl = normalizeUmamiBaseUrl(rawBaseUrl, authMethod)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Invalid Umami base URL.',
    }
  }

  if (authMethod === 'api-key') {
    const apiKey = getString(config.apiKey)
    if (!apiKey) {
      return {
        ok: false,
        missing: ['apiKey'],
      }
    }

    return {
      ok: true,
      value: {
        authMethod,
        baseUrl,
        apiKey,
      },
    }
  }

  const username = getString(config.username)
  const password = getString(config.password)
  if (!username || !password) {
    return {
      ok: false,
      missing: [
        ...(username ? [] : ['username']),
        ...(password ? [] : ['password']),
      ],
    }
  }

  return {
    ok: true,
    value: {
      authMethod,
      baseUrl,
      username,
      password,
    },
  }
}

export function validateUmamiConnectorConfig(
  config: Record<string, unknown>
): ConnectorConfigValidationResult {
  const parsed = parseUmamiConnectorConfig(config)
  if (!parsed.ok) {
    return {
      valid: false,
      missing: parsed.missing,
      message: parsed.message,
    }
  }

  return { valid: true }
}

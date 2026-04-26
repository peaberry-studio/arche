import {
  hasValidHeaders,
  isStringRecord,
} from '@/components/connectors/add-connector/shared'

import type { ConnectorConfigResult } from '@/components/connectors/add-connector/types'

export type CustomConnectorFormState =
  | {
      selectedType: 'custom'
      authType: 'manual'
      name: string
      endpoint: string
      auth: string
      headersText: string
    }
  | {
      selectedType: 'custom'
      authType: 'oauth'
      name: string
      endpoint: string
      oauthScope: string
      oauthClientId: string
      oauthClientSecret: string
      oauthAuthorizationEndpoint: string
      oauthTokenEndpoint: string
      oauthRegistrationEndpoint: string
    }

export function buildCustomConnectorConfig(
  state: CustomConnectorFormState
): ConnectorConfigResult {
  if (!state.endpoint.trim()) {
    return { ok: false, message: 'Endpoint is required.' }
  }

  if (state.authType === 'oauth') {
    return {
      ok: true,
      value: {
        authType: 'oauth',
        endpoint: state.endpoint.trim(),
        oauthScope: state.oauthScope.trim() || undefined,
        oauthClientId: state.oauthClientId.trim() || undefined,
        oauthClientSecret: state.oauthClientSecret.trim() || undefined,
        oauthAuthorizationEndpoint:
          state.oauthAuthorizationEndpoint.trim() || undefined,
        oauthTokenEndpoint: state.oauthTokenEndpoint.trim() || undefined,
        oauthRegistrationEndpoint:
          state.oauthRegistrationEndpoint.trim() || undefined,
      },
    }
  }

  if (!state.headersText.trim()) {
    return {
      ok: true,
      value: {
        authType: 'manual',
        endpoint: state.endpoint.trim(),
        auth: state.auth.trim() || undefined,
      },
    }
  }

  try {
    const parsed = JSON.parse(state.headersText) as unknown
    if (!isStringRecord(parsed)) {
      return {
        ok: false,
        message: 'Headers must be a JSON object with string values.',
      }
    }

    return {
      ok: true,
      value: {
        authType: 'manual',
        endpoint: state.endpoint.trim(),
        auth: state.auth.trim() || undefined,
        headers: parsed,
      },
    }
  } catch {
    return { ok: false, message: 'Headers is not valid JSON.' }
  }
}

export function isCustomConnectorConfigurationComplete(
  state: CustomConnectorFormState
): boolean {
  if (!state.name.trim()) return false

  if (state.authType === 'oauth') {
    return Boolean(state.endpoint.trim())
  }

  return Boolean(state.endpoint.trim() && hasValidHeaders(state.headersText))
}

import type { ConnectorConfigResult } from '@/components/connectors/add-connector/types'

export type UmamiConnectorFormState =
  | {
      selectedType: 'umami'
      umamiAuthMethod: 'api-key'
      umamiBaseUrl: string
      umamiApiKey: string
    }
  | {
      selectedType: 'umami'
      umamiAuthMethod: 'login'
      umamiBaseUrl: string
      umamiUsername: string
      umamiPassword: string
    }

export function buildUmamiConnectorConfig(
  state: UmamiConnectorFormState
): ConnectorConfigResult {
  if (!state.umamiBaseUrl.trim()) {
    return { ok: false, message: 'Umami base URL is required.' }
  }

  if (state.umamiAuthMethod === 'api-key') {
    if (!state.umamiApiKey.trim()) {
      return { ok: false, message: 'Umami API key is required.' }
    }

    return {
      ok: true,
      value: {
        authMethod: 'api-key',
        baseUrl: state.umamiBaseUrl.trim(),
        apiKey: state.umamiApiKey.trim(),
      },
    }
  }

  if (!state.umamiUsername.trim()) {
    return { ok: false, message: 'Umami username is required.' }
  }

  if (!state.umamiPassword.trim()) {
    return { ok: false, message: 'Umami password is required.' }
  }

  return {
    ok: true,
    value: {
      authMethod: 'login',
      baseUrl: state.umamiBaseUrl.trim(),
      username: state.umamiUsername.trim(),
      password: state.umamiPassword.trim(),
    },
  }
}

export function isUmamiConnectorConfigurationComplete(
  state: UmamiConnectorFormState
): boolean {
  if (state.umamiAuthMethod === 'api-key') {
    return Boolean(state.umamiBaseUrl.trim() && state.umamiApiKey.trim())
  }
  return Boolean(
    state.umamiBaseUrl.trim() && state.umamiUsername.trim() && state.umamiPassword.trim()
  )
}

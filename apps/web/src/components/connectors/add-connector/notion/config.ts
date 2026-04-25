import type { ConnectorConfigResult } from '@/components/connectors/add-connector/types'

export type NotionConnectorFormState =
  | { selectedType: 'notion'; authType: 'oauth' }
  | { selectedType: 'notion'; authType: 'manual'; apiKey: string }

export function buildNotionConnectorConfig(
  state: NotionConnectorFormState
): ConnectorConfigResult {
  if (state.authType === 'oauth') {
    return {
      ok: true,
      value: { authType: 'oauth' },
    }
  }

  if (!state.apiKey.trim()) {
    return { ok: false, message: 'API key is required.' }
  }
  return {
    ok: true,
    value: { authType: 'manual', apiKey: state.apiKey.trim() },
  }
}

export function isNotionConnectorConfigurationComplete(
  state: NotionConnectorFormState
): boolean {
  return state.authType === 'oauth' ? true : Boolean(state.apiKey.trim())
}

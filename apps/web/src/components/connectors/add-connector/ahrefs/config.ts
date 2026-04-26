import type { ConnectorConfigResult } from '@/components/connectors/add-connector/types'

export type AhrefsConnectorFormState = {
  selectedType: 'ahrefs'
  apiKey: string
}

export function buildAhrefsConnectorConfig(
  state: AhrefsConnectorFormState
): ConnectorConfigResult {
  if (!state.apiKey.trim()) {
    return { ok: false, message: 'Ahrefs API key is required.' }
  }

  return {
    ok: true,
    value: {
      apiKey: state.apiKey.trim(),
    },
  }
}

export function isAhrefsConnectorConfigurationComplete(
  state: AhrefsConnectorFormState
): boolean {
  return Boolean(state.apiKey.trim())
}

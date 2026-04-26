import type { ConnectorConfigResult } from '@/components/connectors/add-connector/types'
import type { GoogleWorkspaceConnectorType } from '@/lib/connectors/google-workspace'

export type GoogleWorkspaceConnectorFormState = {
  selectedType: GoogleWorkspaceConnectorType
  authType: 'oauth'
}

export function buildGoogleWorkspaceConnectorConfig(
  state: GoogleWorkspaceConnectorFormState
): ConnectorConfigResult {
  if (state.authType === 'oauth') {
    return {
      ok: true,
      value: { authType: 'oauth' },
    }
  }

  return {
    ok: false,
    message: 'Google Workspace connectors only support OAuth.',
  }
}

export function isGoogleWorkspaceConnectorConfigurationComplete(
  state: GoogleWorkspaceConnectorFormState
): boolean {
  return state.authType === 'oauth'
}

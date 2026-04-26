import {
  buildAhrefsConnectorConfig,
  isAhrefsConnectorConfigurationComplete,
  type AhrefsConnectorFormState,
} from '@/components/connectors/add-connector/ahrefs/config'
import {
  buildCustomConnectorConfig,
  isCustomConnectorConfigurationComplete,
  type CustomConnectorFormState,
} from '@/components/connectors/add-connector/custom/config'
import {
  buildGoogleWorkspaceConnectorConfig,
  isGoogleWorkspaceConnectorConfigurationComplete,
  type GoogleWorkspaceConnectorFormState,
} from '@/components/connectors/add-connector/google-workspace/config'
import {
  buildLinearConnectorConfig,
  isLinearConnectorConfigurationComplete,
  type LinearConnectorFormState,
} from '@/components/connectors/add-connector/linear/config'
import {
  buildNotionConnectorConfig,
  isNotionConnectorConfigurationComplete,
  type NotionConnectorFormState,
} from '@/components/connectors/add-connector/notion/config'
import {
  buildUmamiConnectorConfig,
  isUmamiConnectorConfigurationComplete,
  type UmamiConnectorFormState,
} from '@/components/connectors/add-connector/umami/config'
import {
  buildZendeskConnectorConfig,
  isZendeskConnectorConfigurationComplete,
  type ZendeskConnectorFormState,
} from '@/components/connectors/add-connector/zendesk/config'

export {
  CONNECTOR_TYPE_OPTIONS,
  DEFAULT_LINEAR_OAUTH_ACTOR,
  DEFAULT_TYPE,
  buildDefaultName,
  getDefaultAuthType,
  hasValidHeaders,
  isStringRecord,
  supportsOAuth,
} from '@/components/connectors/add-connector/shared'

export type { AhrefsConnectorFormState } from '@/components/connectors/add-connector/ahrefs/config'
export type { CustomConnectorFormState } from '@/components/connectors/add-connector/custom/config'
export type { GoogleWorkspaceConnectorFormState } from '@/components/connectors/add-connector/google-workspace/config'
export type { LinearConnectorFormState } from '@/components/connectors/add-connector/linear/config'
export type { NotionConnectorFormState } from '@/components/connectors/add-connector/notion/config'
export type { ConnectorConfigResult } from '@/components/connectors/add-connector/types'
export type { UmamiConnectorFormState } from '@/components/connectors/add-connector/umami/config'
export type { ZendeskConnectorFormState } from '@/components/connectors/add-connector/zendesk/config'

export type ConnectorFormState =
  | LinearConnectorFormState
  | NotionConnectorFormState
  | ZendeskConnectorFormState
  | AhrefsConnectorFormState
  | UmamiConnectorFormState
  | GoogleWorkspaceConnectorFormState
  | CustomConnectorFormState

export function buildConnectorConfig(
  state: ConnectorFormState
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string } {
  switch (state.selectedType) {
    case 'linear':
      return buildLinearConnectorConfig(state)
    case 'notion':
      return buildNotionConnectorConfig(state)
    case 'zendesk':
      return buildZendeskConnectorConfig(state)
    case 'ahrefs':
      return buildAhrefsConnectorConfig(state)
    case 'umami':
      return buildUmamiConnectorConfig(state)
    case 'google_gmail':
    case 'google_drive':
    case 'google_calendar':
    case 'google_chat':
    case 'google_people':
      return buildGoogleWorkspaceConnectorConfig(state)
    case 'custom':
      return buildCustomConnectorConfig(state)
  }
}

export function isConnectorConfigurationComplete(
  state: ConnectorFormState
): boolean {
  switch (state.selectedType) {
    case 'linear':
      return isLinearConnectorConfigurationComplete(state)
    case 'notion':
      return isNotionConnectorConfigurationComplete(state)
    case 'zendesk':
      return isZendeskConnectorConfigurationComplete(state)
    case 'ahrefs':
      return isAhrefsConnectorConfigurationComplete(state)
    case 'umami':
      return isUmamiConnectorConfigurationComplete(state)
    case 'google_gmail':
    case 'google_drive':
    case 'google_calendar':
    case 'google_chat':
    case 'google_people':
      return isGoogleWorkspaceConnectorConfigurationComplete(state)
    case 'custom':
      return isCustomConnectorConfigurationComplete(state)
  }
}

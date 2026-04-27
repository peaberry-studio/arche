import type { ConnectorConfigResult } from '@/components/connectors/add-connector/types'
import { DEFAULT_META_ADS_CONNECTOR_PERMISSIONS } from '@/lib/connectors/meta-ads-types'

export type MetaAdsConnectorFormState = {
  selectedType: 'meta-ads'
  appId: string
  appSecret: string
}

export function buildMetaAdsConnectorConfig(
  state: MetaAdsConnectorFormState
): ConnectorConfigResult {
  if (!state.appId.trim()) {
    return { ok: false, message: 'Meta Ads App ID is required.' }
  }

  if (!state.appSecret.trim()) {
    return { ok: false, message: 'Meta Ads App Secret is required.' }
  }

  return {
    ok: true,
    value: {
      authType: 'oauth',
      appId: state.appId.trim(),
      appSecret: state.appSecret.trim(),
      permissions: DEFAULT_META_ADS_CONNECTOR_PERMISSIONS,
      selectedAdAccountIds: [],
    },
  }
}

export function isMetaAdsConnectorConfigurationComplete(
  state: MetaAdsConnectorFormState
): boolean {
  return Boolean(state.appId.trim() && state.appSecret.trim())
}

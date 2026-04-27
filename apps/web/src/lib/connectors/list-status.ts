import { isMetaAdsConnectorReady } from '@/lib/connectors/meta-ads'

type ConnectorListStatus = 'ready' | 'pending' | 'disabled'

export function getConnectorListStatus(input: {
  type: string
  enabled: boolean
  authType: 'manual' | 'oauth'
  oauthConnected: boolean
  config: Record<string, unknown>
}): ConnectorListStatus {
  if (!input.enabled) return 'disabled'

  if (input.type === 'meta-ads') {
    return input.authType === 'oauth' && input.oauthConnected && isMetaAdsConnectorReady(input.config)
      ? 'ready'
      : 'pending'
  }

  return input.authType === 'oauth' && !input.oauthConnected ? 'pending' : 'ready'
}

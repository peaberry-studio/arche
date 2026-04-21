export const CONNECTOR_TYPES = ['linear', 'notion', 'zendesk', 'custom', 'meta-ads'] as const
export type ConnectorType = (typeof CONNECTOR_TYPES)[number]

export function isConnectorType(value: string): value is ConnectorType {
  return CONNECTOR_TYPES.includes(value as ConnectorType)
}

export const SINGLE_INSTANCE_CONNECTOR_TYPES = ['linear', 'notion', 'zendesk', 'meta-ads'] as const satisfies readonly ConnectorType[]

export function isSingleInstanceConnectorType(type: ConnectorType): boolean {
  return SINGLE_INSTANCE_CONNECTOR_TYPES.includes(type as (typeof SINGLE_INSTANCE_CONNECTOR_TYPES)[number])
}

export const OAUTH_CONNECTOR_TYPES = ['linear', 'notion', 'custom', 'meta-ads'] as const
export type OAuthConnectorType = (typeof OAUTH_CONNECTOR_TYPES)[number]

export type ConnectorAuthType = 'manual' | 'oauth'

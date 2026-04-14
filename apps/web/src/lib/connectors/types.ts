export const CONNECTOR_TYPES = ['linear', 'notion', 'zendesk', 'custom'] as const
export type ConnectorType = (typeof CONNECTOR_TYPES)[number]

export const SINGLE_INSTANCE_CONNECTOR_TYPES = ['linear', 'notion', 'zendesk'] as const satisfies readonly ConnectorType[]

export function isSingleInstanceConnectorType(type: ConnectorType): boolean {
  return SINGLE_INSTANCE_CONNECTOR_TYPES.includes(type as (typeof SINGLE_INSTANCE_CONNECTOR_TYPES)[number])
}

export const OAUTH_CONNECTOR_TYPES = ['linear', 'notion', 'custom'] as const
export type OAuthConnectorType = (typeof OAUTH_CONNECTOR_TYPES)[number]

export type ConnectorAuthType = 'manual' | 'oauth'

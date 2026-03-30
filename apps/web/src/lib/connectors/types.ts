export const CONNECTOR_TYPES = ['linear', 'notion', 'custom'] as const
export type ConnectorType = (typeof CONNECTOR_TYPES)[number]

export const OAUTH_CONNECTOR_TYPES = ['linear', 'notion', 'custom'] as const
export type OAuthConnectorType = (typeof OAUTH_CONNECTOR_TYPES)[number]

export type ConnectorAuthType = 'manual' | 'oauth'

export const CONNECTOR_TYPES = ['linear', 'notion', 'slack', 'github', 'custom'] as const
export type ConnectorType = (typeof CONNECTOR_TYPES)[number]

export type OAuthMetadataOverrides = {
  authorizationEndpoint?: string
  tokenEndpoint?: string
  registrationEndpoint?: string
}

export type OAuthClientRegistration = {
  clientId: string
  clientSecret?: string
}

export type OAuthProviderStrategy = {
  getMcpServerUrl(connectorConfig?: Record<string, unknown>): Promise<string>
  getScope(connectorConfig?: Record<string, unknown>): string | undefined
  getStaticClientRegistration(connectorConfig?: Record<string, unknown>): OAuthClientRegistration | null
  preferStaticClientRegistration(connectorConfig?: Record<string, unknown>): boolean
  getMetadataOverrides(connectorConfig?: Record<string, unknown>): Promise<OAuthMetadataOverrides>
  shouldValidateMetadataEndpoints(): boolean
  decorateAuthorizeUrl(url: URL, connectorConfig?: Record<string, unknown>): void
  usesPkce(): boolean
  resolveTokenEndpoint(tokenEndpoint: string): Promise<string>
  resolveRefreshTokenEndpoint(input: {
    tokenEndpoint?: string
    mcpServerUrl?: string
  }): Promise<string>
}

import crypto from 'node:crypto'

import { OAUTH_CONNECTOR_TYPES, type ConnectorType, type OAuthConnectorType } from '@/lib/connectors/types'
import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'

type OAuthStatePayload = {
  connectorId: string
  slug: string
  userId: string
  connectorType: OAuthConnectorType
  exp: number
  nonce: string
  redirectUri?: string
  codeVerifier?: string
  clientId?: string
  clientSecret?: string
  tokenEndpoint?: string
  authorizationEndpoint?: string
  registrationEndpoint?: string
  issuer?: string
  mcpServerUrl?: string
}

type OAuthServerMetadata = {
  issuer?: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
}

type OAuthClientRegistration = {
  clientId: string
  clientSecret?: string
}

type OAuthTokenResult = {
  accessToken: string
  refreshToken?: string
  tokenType?: string
  scope?: string
  expiresAt?: string
}

type OAuthMetadataOverrides = {
  authorizationEndpoint?: string
  tokenEndpoint?: string
  registrationEndpoint?: string
}

type OAuthPreparationContext = {
  mcpServerUrl: string
  scope?: string
  staticClientRegistration: OAuthClientRegistration | null
  metadataOverrides: OAuthMetadataOverrides
  validateMetadataEndpoints: boolean
}

const MCP_SERVER_URLS = {
  linear: 'https://mcp.linear.app/mcp',
  notion: 'https://mcp.notion.com/mcp',
} as const

function getOAuthStateSecret(): string {
  const secret = process.env.ARCHE_CONNECTOR_OAUTH_STATE_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ARCHE_CONNECTOR_OAUTH_STATE_SECRET is required in production')
  }
  console.warn('[security] Using insecure development secret for OAuth state. Set ARCHE_CONNECTOR_OAUTH_STATE_SECRET env var.')
  return 'dev-insecure-connector-oauth-state-secret'
}

function getOAuthStateEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(getOAuthStateSecret()).digest()
}

function getOAuthStateTtlSeconds(): number {
  const raw = process.env.ARCHE_CONNECTOR_OAUTH_STATE_TTL_SECONDS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 900
}

function getOAuthAuthorizeUrlMaxLength(): number {
  const raw = process.env.ARCHE_CONNECTOR_OAUTH_MAX_AUTHORIZE_URL_LENGTH
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1800
}

async function validateConnectorUrl(rawUrl: string): Promise<string> {
  const validation = await validateConnectorTestEndpoint(rawUrl)
  if (!validation.ok) {
    throw new Error(validation.error)
  }
  return validation.url.toString()
}

function getOptionalScope(type: Exclude<OAuthConnectorType, 'custom'>): string | undefined {
  if (type === 'linear') {
    const value = process.env.ARCHE_CONNECTOR_LINEAR_SCOPE
    return value && value.trim() ? value.trim() : undefined
  }

  const value = process.env.ARCHE_CONNECTOR_NOTION_SCOPE
  return value && value.trim() ? value.trim() : undefined
}

function getOfficialMcpServerUrl(type: Exclude<OAuthConnectorType, 'custom'>): string {
  if (type === 'linear') {
    return process.env.ARCHE_CONNECTOR_LINEAR_MCP_URL || MCP_SERVER_URLS.linear
  }

  return process.env.ARCHE_CONNECTOR_NOTION_MCP_URL || MCP_SERVER_URLS.notion
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function sanitizeOAuthMetadata(metadata: OAuthServerMetadata): Promise<OAuthServerMetadata> {
  return {
    issuer: metadata.issuer,
    authorizationEndpoint: await validateConnectorUrl(metadata.authorizationEndpoint),
    tokenEndpoint: await validateConnectorUrl(metadata.tokenEndpoint),
    registrationEndpoint: metadata.registrationEndpoint
      ? await validateConnectorUrl(metadata.registrationEndpoint)
      : undefined,
  }
}

function resolveOAuthMetadata(
  discovered: OAuthServerMetadata,
  overrides: OAuthMetadataOverrides
): OAuthServerMetadata {
  return {
    issuer: discovered.issuer,
    authorizationEndpoint: overrides.authorizationEndpoint ?? discovered.authorizationEndpoint,
    tokenEndpoint: overrides.tokenEndpoint ?? discovered.tokenEndpoint,
    registrationEndpoint: overrides.registrationEndpoint ?? discovered.registrationEndpoint,
  }
}

function parseExpiresAt(expiresIn: unknown): string | undefined {
  if (typeof expiresIn === 'string' && expiresIn.trim()) {
    const parsed = Number(expiresIn)
    if (Number.isFinite(parsed) && parsed > 0) {
      return new Date(Date.now() + parsed * 1000).toISOString()
    }
  }

  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000).toISOString()
  }

  return undefined
}

function mapTokenResponse(raw: unknown): OAuthTokenResult {
  const data = raw as Record<string, unknown>
  const accessToken = getString(data.access_token)
  if (!accessToken) {
    throw new Error('oauth_missing_access_token')
  }

  return {
    accessToken,
    refreshToken: getString(data.refresh_token),
    tokenType: getString(data.token_type),
    scope: getString(data.scope),
    expiresAt: parseExpiresAt(data.expires_in),
  }
}

function encodeStatePayload(payload: OAuthStatePayload): string {
  const key = getOAuthStateEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, encrypted, tag].map((part) => part.toString('base64url')).join('.')
}

function decodeStatePayload(token: string): OAuthStatePayload {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('invalid_state')
  }

  const [ivPart, encryptedPart, tagPart] = parts
  if (!ivPart || !encryptedPart || !tagPart) {
    throw new Error('invalid_state')
  }

  try {
    const key = getOAuthStateEncryptionKey()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'base64url')),
      decipher.final(),
    ])

    const payload = JSON.parse(decrypted.toString('utf8')) as OAuthStatePayload
    if (!payload || typeof payload !== 'object') {
      throw new Error('invalid_state')
    }
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error('expired_state')
    }
    if (!isOAuthConnectorType(payload.connectorType)) {
      throw new Error('invalid_state')
    }
    return payload
  } catch (error) {
    if (error instanceof Error && (error.message === 'expired_state' || error.message === 'invalid_state')) {
      throw error
    }
    throw new Error('invalid_state')
  }
}

async function postForm(
  endpoint: string,
  values: Record<string, string>,
  errorPrefix: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(values).toString(),
    cache: 'no-store',
  })

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok || !data) {
    throw new Error(errorPrefix)
  }
  if (typeof data.error === 'string' && data.error.trim()) {
    const description = getString(data.error_description)
    throw new Error(description ? `${errorPrefix}:${data.error}:${description}` : `${errorPrefix}:${data.error}`)
  }

  return data
}

async function discoverOAuthMetadata(mcpServerUrl: string): Promise<OAuthServerMetadata> {
  const serverUrl = new URL(mcpServerUrl)
  const authorizationBase = `${serverUrl.protocol}//${serverUrl.host}`
  const metadataUrl = `${authorizationBase}/.well-known/oauth-authorization-server`

  const metadataResponse = await fetch(metadataUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  }).catch(() => null)

  if (metadataResponse && metadataResponse.ok) {
    const data = (await metadataResponse.json().catch(() => null)) as Record<string, unknown> | null
    const authorizationEndpoint = getString(data?.authorization_endpoint)
    const tokenEndpoint = getString(data?.token_endpoint)
    if (!authorizationEndpoint || !tokenEndpoint) {
      throw new Error('oauth_discovery_failed:invalid_metadata')
    }

    return {
      issuer: getString(data?.issuer),
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint: getString(data?.registration_endpoint),
    }
  }

  if (metadataResponse && metadataResponse.status !== 404) {
    throw new Error(`oauth_discovery_failed:${metadataResponse.status}`)
  }

  return {
    authorizationEndpoint: `${authorizationBase}/authorize`,
    tokenEndpoint: `${authorizationBase}/token`,
    registrationEndpoint: `${authorizationBase}/register`,
  }
}

function getStaticOAuthClientRegistration(
  type: OAuthConnectorType,
  connectorConfig?: Record<string, unknown>,
): OAuthClientRegistration | null {
  if (type === 'custom') {
    const clientId = getString(connectorConfig?.oauthClientId)
    if (!clientId) return null
    return {
      clientId,
      clientSecret: getString(connectorConfig?.oauthClientSecret),
    }
  }

  if (type === 'linear') {
    const clientId = process.env.ARCHE_CONNECTOR_LINEAR_CLIENT_ID
    if (!clientId || !clientId.trim()) return null
    const clientSecret = process.env.ARCHE_CONNECTOR_LINEAR_CLIENT_SECRET
    return {
      clientId: clientId.trim(),
      clientSecret: clientSecret?.trim() || undefined,
    }
  }

  const clientId = process.env.ARCHE_CONNECTOR_NOTION_CLIENT_ID
  if (!clientId || !clientId.trim()) return null
  const clientSecret = process.env.ARCHE_CONNECTOR_NOTION_CLIENT_SECRET
  return {
    clientId: clientId.trim(),
    clientSecret: clientSecret?.trim() || undefined,
  }
}

async function resolveOAuthPreparationContext(input: {
  connectorType: OAuthConnectorType
  connectorConfig?: Record<string, unknown>
}): Promise<OAuthPreparationContext> {
  if (input.connectorType !== 'custom') {
    return {
      mcpServerUrl: getOfficialMcpServerUrl(input.connectorType),
      scope: getOptionalScope(input.connectorType),
      staticClientRegistration: getStaticOAuthClientRegistration(input.connectorType),
      metadataOverrides: {},
      validateMetadataEndpoints: false,
    }
  }

  const connectorConfig = input.connectorConfig
  const endpoint = getString(connectorConfig?.endpoint)
  if (!endpoint) {
    throw new Error('missing_endpoint')
  }

  const authorizationEndpoint = getString(connectorConfig?.oauthAuthorizationEndpoint)
  const tokenEndpoint = getString(connectorConfig?.oauthTokenEndpoint)
  const registrationEndpoint = getString(connectorConfig?.oauthRegistrationEndpoint)

  return {
    mcpServerUrl: await validateConnectorUrl(endpoint),
    scope: getString(connectorConfig?.oauthScope),
    staticClientRegistration: getStaticOAuthClientRegistration(input.connectorType, connectorConfig),
    metadataOverrides: {
      authorizationEndpoint: authorizationEndpoint
        ? await validateConnectorUrl(authorizationEndpoint)
        : undefined,
      tokenEndpoint: tokenEndpoint ? await validateConnectorUrl(tokenEndpoint) : undefined,
      registrationEndpoint: registrationEndpoint
        ? await validateConnectorUrl(registrationEndpoint)
        : undefined,
    },
    validateMetadataEndpoints: true,
  }
}

async function resolveAuthorizationMetadata(
  context: OAuthPreparationContext,
): Promise<OAuthServerMetadata> {
  const manualAuthorizationEndpoint = context.metadataOverrides.authorizationEndpoint
  const manualTokenEndpoint = context.metadataOverrides.tokenEndpoint

  if (manualAuthorizationEndpoint && manualTokenEndpoint) {
    const metadata: OAuthServerMetadata = {
      authorizationEndpoint: manualAuthorizationEndpoint,
      tokenEndpoint: manualTokenEndpoint,
      registrationEndpoint: context.metadataOverrides.registrationEndpoint,
    }

    return context.validateMetadataEndpoints
      ? sanitizeOAuthMetadata(metadata)
      : metadata
  }

  const discovered = await discoverOAuthMetadata(context.mcpServerUrl)
  const metadata = resolveOAuthMetadata(discovered, context.metadataOverrides)
  return context.validateMetadataEndpoints
    ? sanitizeOAuthMetadata(metadata)
    : metadata
}

async function registerOAuthClient(
  metadata: OAuthServerMetadata,
  redirectUri: string,
  connectorType: OAuthConnectorType,
  staticRegistration: OAuthClientRegistration | null,
): Promise<OAuthClientRegistration> {
  if (!metadata.registrationEndpoint) {
    if (staticRegistration) return staticRegistration
    throw new Error('oauth_registration_failed:missing_registration_endpoint')
  }

  const response = await fetch(metadata.registrationEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_name: `Arche ${connectorType} MCP Connector`,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    cache: 'no-store',
  }).catch(() => null)

  if (!response || !response.ok) {
    if (staticRegistration) return staticRegistration
    const status = response?.status ?? 0
    throw new Error(`oauth_registration_failed:${status || 'network'}`)
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
  const clientId = getString(data?.client_id)
  if (!clientId) {
    if (staticRegistration) return staticRegistration
    throw new Error('oauth_registration_failed:missing_client_id')
  }

  return {
    clientId,
    clientSecret: getString(data?.client_secret),
  }
}

function createPkceCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

function createPkceCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

export function isOAuthConnectorType(type: ConnectorType): type is OAuthConnectorType {
  return OAUTH_CONNECTOR_TYPES.includes(type as OAuthConnectorType)
}

export function issueConnectorOAuthState(input: {
  connectorId: string
  slug: string
  userId: string
  connectorType: OAuthConnectorType
  redirectUri?: string
  codeVerifier?: string
  clientId?: string
  clientSecret?: string
  tokenEndpoint?: string
  authorizationEndpoint?: string
  registrationEndpoint?: string
  issuer?: string
  mcpServerUrl?: string
}): string {
  return encodeStatePayload({
    connectorId: input.connectorId,
    slug: input.slug,
    userId: input.userId,
    connectorType: input.connectorType,
    exp: Math.floor(Date.now() / 1000) + getOAuthStateTtlSeconds(),
    nonce: crypto.randomBytes(16).toString('base64url'),
    redirectUri: input.redirectUri,
    codeVerifier: input.codeVerifier,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    tokenEndpoint: input.tokenEndpoint,
    authorizationEndpoint: input.authorizationEndpoint,
    registrationEndpoint: input.registrationEndpoint,
    issuer: input.issuer,
    mcpServerUrl: input.mcpServerUrl,
  })
}

export function verifyConnectorOAuthState(token: string): OAuthStatePayload {
  return decodeStatePayload(token)
}

export async function prepareConnectorOAuthAuthorization(input: {
  connectorId: string
  slug: string
  userId: string
  connectorType: OAuthConnectorType
  redirectUri: string
  connectorConfig?: Record<string, unknown>
}): Promise<{ authorizeUrl: string; state: string }> {
  const context = await resolveOAuthPreparationContext({
    connectorType: input.connectorType,
    connectorConfig: input.connectorConfig,
  })

  const metadata = await resolveAuthorizationMetadata(context)
  const client = await registerOAuthClient(
    metadata,
    input.redirectUri,
    input.connectorType,
    context.staticClientRegistration,
  )

  const codeVerifier = createPkceCodeVerifier()
  const codeChallenge = createPkceCodeChallenge(codeVerifier)

  const state = issueConnectorOAuthState({
    connectorId: input.connectorId,
    slug: input.slug,
    userId: input.userId,
    connectorType: input.connectorType,
    redirectUri: input.redirectUri,
    codeVerifier,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    tokenEndpoint: metadata.tokenEndpoint,
    authorizationEndpoint: metadata.authorizationEndpoint,
    registrationEndpoint: metadata.registrationEndpoint,
    issuer: metadata.issuer,
    mcpServerUrl: context.mcpServerUrl,
  })

  const authorizeUrl = new URL(metadata.authorizationEndpoint)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', client.clientId)
  authorizeUrl.searchParams.set('redirect_uri', input.redirectUri)
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('code_challenge', codeChallenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')

  const scope = context.scope
  if (scope) {
    authorizeUrl.searchParams.set('scope', scope)
  }

  const authorizeUrlString = authorizeUrl.toString()
  if (authorizeUrlString.length > getOAuthAuthorizeUrlMaxLength()) {
    throw new Error('oauth_state_too_large')
  }

  return { authorizeUrl: authorizeUrlString, state }
}

export async function exchangeConnectorOAuthCode(input: {
  code: string
  redirectUri: string
  state: OAuthStatePayload
}): Promise<OAuthTokenResult> {
  if (!input.state.clientId || !input.state.codeVerifier || !input.state.tokenEndpoint) {
    throw new Error('invalid_state')
  }

  const form: Record<string, string> = {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.state.clientId,
    code_verifier: input.state.codeVerifier,
  }

  if (input.state.clientSecret) {
    form.client_secret = input.state.clientSecret
  }

  const tokenEndpoint = input.state.connectorType === 'custom'
    ? await validateConnectorUrl(input.state.tokenEndpoint)
    : input.state.tokenEndpoint
  const data = await postForm(tokenEndpoint, form, 'oauth_exchange_failed')
  return mapTokenResponse(data)
}

export async function refreshConnectorOAuthToken(input: {
  connectorType: OAuthConnectorType
  refreshToken: string
  clientId: string
  clientSecret?: string
  tokenEndpoint?: string
  mcpServerUrl?: string
}): Promise<OAuthTokenResult> {
  let tokenEndpoint: string

  if (input.tokenEndpoint) {
    tokenEndpoint = input.connectorType === 'custom'
      ? await validateConnectorUrl(input.tokenEndpoint)
      : input.tokenEndpoint
  } else {
    if (input.connectorType === 'custom') {
      if (!input.mcpServerUrl) {
        throw new Error('oauth_refresh_failed:missing_mcp_server_url')
      }

      const safeMcpServerUrl = await validateConnectorUrl(input.mcpServerUrl)
      const metadata = await sanitizeOAuthMetadata(await discoverOAuthMetadata(safeMcpServerUrl))
      tokenEndpoint = metadata.tokenEndpoint
    } else {
      tokenEndpoint = (await discoverOAuthMetadata(getOfficialMcpServerUrl(input.connectorType))).tokenEndpoint
    }
  }

  const form: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  }

  if (input.clientSecret) {
    form.client_secret = input.clientSecret
  }

  const data = await postForm(tokenEndpoint, form, 'oauth_refresh_failed')
  return mapTokenResponse(data)
}

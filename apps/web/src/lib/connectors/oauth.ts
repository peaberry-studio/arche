import crypto from 'node:crypto'

import { isGoogleWorkspaceConnectorType } from '@/lib/connectors/google-workspace'
import { discoverOAuthMetadata, getString, sanitizeOAuthMetadata, type OAuthServerMetadata } from '@/lib/connectors/oauth-metadata'
import { getStrategy } from '@/lib/connectors/oauth-provider-strategies'
import { OAUTH_CONNECTOR_TYPES, type ConnectorType, type OAuthConnectorType } from '@/lib/connectors/types'

type OAuthStatePayload = {
  connectorId: string
  slug: string
  returnTo?: string
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
  preferStaticClientRegistration: boolean
  metadataOverrides: OAuthMetadataOverrides
  validateMetadataEndpoints: boolean
}

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

async function getJson(endpoint: string, errorPrefix: string): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
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

async function resolveOAuthPreparationContext(input: {
  connectorType: OAuthConnectorType
  connectorConfig?: Record<string, unknown>
}): Promise<OAuthPreparationContext> {
  const strategy = getStrategy(input.connectorType)

  if (input.connectorType === 'meta-ads') {
    const client = strategy.getStaticClientRegistration(input.connectorConfig)
    if (!client?.clientId) {
      throw new Error('meta_ads_missing_app_id')
    }
    if (!client.clientSecret) {
      throw new Error('meta_ads_missing_app_secret')
    }
  }

  const mcpServerUrl = await strategy.getMcpServerUrl(input.connectorConfig)
  const scope = strategy.getScope(input.connectorConfig)
  const staticClientRegistration = strategy.getStaticClientRegistration(input.connectorConfig)
  const preferStaticClientRegistration = strategy.preferStaticClientRegistration(input.connectorConfig)

  if (preferStaticClientRegistration && !staticClientRegistration) {
    const errorCode = isGoogleWorkspaceConnectorType(input.connectorType)
      ? 'missing_google_oauth_client_credentials'
      : 'missing_linear_oauth_client_credentials'
    throw new Error(errorCode)
  }

  return {
    mcpServerUrl,
    scope,
    staticClientRegistration,
    preferStaticClientRegistration,
    metadataOverrides: await strategy.getMetadataOverrides(input.connectorConfig),
    validateMetadataEndpoints: strategy.shouldValidateMetadataEndpoints(),
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
  preferStaticClientRegistration: boolean,
): Promise<OAuthClientRegistration> {
  if (staticRegistration && preferStaticClientRegistration) {
    return staticRegistration
  }

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

export function normalizeConnectorOAuthReturnTo(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  try {
    const url = new URL(value, 'http://localhost')
    if (url.origin !== 'http://localhost') {
      return undefined
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return undefined
  }
}

export function issueConnectorOAuthState(input: {
  connectorId: string
  slug: string
  returnTo?: string
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
    returnTo: input.returnTo,
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
  returnTo?: string
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
    context.preferStaticClientRegistration,
  )

  const strategy = getStrategy(input.connectorType)
  const usePkce = strategy.usesPkce()
  const codeVerifier = usePkce ? createPkceCodeVerifier() : undefined
  const codeChallenge = codeVerifier ? createPkceCodeChallenge(codeVerifier) : undefined

  const state = issueConnectorOAuthState({
    connectorId: input.connectorId,
    slug: input.slug,
    returnTo: input.returnTo,
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
  if (codeChallenge) {
    authorizeUrl.searchParams.set('code_challenge', codeChallenge)
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  }

  const scope = context.scope
  if (scope) {
    authorizeUrl.searchParams.set('scope', scope)
  }

  strategy.decorateAuthorizeUrl(authorizeUrl, input.connectorConfig)

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
  if (input.state.connectorType === 'meta-ads') {
    if (!input.state.clientId || !input.state.clientSecret || !input.state.tokenEndpoint) {
      throw new Error('invalid_state')
    }

    const shortLivedUrl = new URL(input.state.tokenEndpoint)
    shortLivedUrl.searchParams.set('client_id', input.state.clientId)
    shortLivedUrl.searchParams.set('redirect_uri', input.redirectUri)
    shortLivedUrl.searchParams.set('client_secret', input.state.clientSecret)
    shortLivedUrl.searchParams.set('code', input.code)

    const shortLived = mapTokenResponse(await getJson(shortLivedUrl.toString(), 'oauth_exchange_failed'))

    const longLivedUrl = new URL(input.state.tokenEndpoint)
    longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token')
    longLivedUrl.searchParams.set('client_id', input.state.clientId)
    longLivedUrl.searchParams.set('client_secret', input.state.clientSecret)
    longLivedUrl.searchParams.set('fb_exchange_token', shortLived.accessToken)

    const longLived = mapTokenResponse(await getJson(longLivedUrl.toString(), 'oauth_exchange_failed'))

    return {
      accessToken: longLived.accessToken,
      tokenType: longLived.tokenType ?? shortLived.tokenType,
      scope: longLived.scope ?? shortLived.scope,
      expiresAt: longLived.expiresAt ?? shortLived.expiresAt,
    }
  }

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

  const strategy = getStrategy(input.state.connectorType)
  const tokenEndpoint = await strategy.resolveTokenEndpoint(input.state.tokenEndpoint)
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
  const strategy = getStrategy(input.connectorType)
  const tokenEndpoint = await strategy.resolveRefreshTokenEndpoint({
    tokenEndpoint: input.tokenEndpoint,
    mcpServerUrl: input.mcpServerUrl,
  })

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

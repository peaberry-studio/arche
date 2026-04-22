import { createHash } from 'node:crypto'

import { isRecord, getString } from '@/lib/connectors/connector-values'
import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'

import type { UmamiApiResponse, UmamiConnectorConfig } from '@/lib/connectors/umami-types'

const UMAMI_TIMEOUT_MS = 15_000
const UMAMI_LOGIN_CACHE_TTL_MS = 60_000

type UmamiLoginCacheEntry = {
  token: string
  expiresAt: number
}

type RequestUmamiJsonInput = {
  config: UmamiConnectorConfig
  path: string
  method?: 'GET' | 'POST'
  searchParams?: URLSearchParams
  body?: unknown
}

const umamiLoginTokenCache = new Map<string, UmamiLoginCacheEntry>()

function parseRetryAfter(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after')
  if (!retryAfter) return undefined

  const seconds = Number(retryAfter)
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : undefined
}

function extractUmamiErrorDetail(payload: unknown): string | undefined {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim()
  }

  if (!isRecord(payload)) {
    return undefined
  }

  const directKeys = ['message', 'error', 'detail', 'description']
  for (const key of directKeys) {
    const value = getString(payload[key])
    if (value) return value
  }

  return undefined
}

function buildValidationFailure<TData = unknown>(
  error: 'invalid_endpoint' | 'blocked_endpoint'
): UmamiApiResponse<TData> {
  return {
    ok: false,
    error,
    message:
      error === 'blocked_endpoint'
        ? 'Umami base URL is blocked for security reasons.'
        : 'Umami base URL must be a valid public HTTPS URL.',
    status: 400,
  }
}

function buildUmamiUrl(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
}

function getUmamiSecretFingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function getUmamiLoginCacheKey(baseUrl: string, username: string, password: string): string {
  return `${baseUrl}\n${username}\n${getUmamiSecretFingerprint(password)}`
}

function getCachedUmamiLoginToken(cacheKey: string): string | null {
  const entry = umamiLoginTokenCache.get(cacheKey)
  if (!entry) {
    return null
  }

  if (entry.expiresAt <= Date.now()) {
    umamiLoginTokenCache.delete(cacheKey)
    return null
  }

  return entry.token
}

function setCachedUmamiLoginToken(cacheKey: string, token: string): void {
  umamiLoginTokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + UMAMI_LOGIN_CACHE_TTL_MS,
  })
}

function clearCachedUmamiLoginToken(cacheKey: string | undefined): void {
  if (!cacheKey) return
  umamiLoginTokenCache.delete(cacheKey)
}

async function fetchJson(url: URL, init: RequestInit): Promise<UmamiApiResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UMAMI_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
    })

    const contentType = response.headers.get('content-type') ?? ''
    let payload: unknown = null
    if (response.status !== 204) {
      if (contentType.includes('application/json')) {
        payload = await response.json().catch(() => null)
      } else {
        const text = await response.text().catch(() => '')
        payload = text || null
      }
    }

    if (!response.ok) {
      const detail = extractUmamiErrorDetail(payload)
      return {
        ok: false,
        error: 'umami_request_failed',
        message: detail
          ? `Umami request failed (${response.status}): ${detail}`
          : `Umami request failed (${response.status})`,
        status: response.status,
        headers: response.headers,
        data: payload,
        retryAfter: parseRetryAfter(response.headers),
      }
    }

    return {
      ok: true,
      data: payload,
      status: response.status,
      headers: response.headers,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'
    return {
      ok: false,
      error: 'umami_request_failed',
      message: `Umami request failed: ${message}`,
      status: 0,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function resolveValidatedBaseUrl(config: UmamiConnectorConfig): Promise<UmamiApiResponse<string>> {
  const validation = await validateConnectorTestEndpoint(config.baseUrl)
  if (!validation.ok) {
    return buildValidationFailure(validation.error)
  }

  return {
    ok: true,
    data: validation.url.toString(),
    status: 200,
    headers: new Headers(),
  }
}

async function buildAuthHeaders(
  config: UmamiConnectorConfig,
  baseUrl: string,
  options?: { forceRefresh?: boolean }
): Promise<
  | { ok: true; headers: Headers; cacheKey?: string; usedCachedToken?: boolean }
  | { ok: false; response: UmamiApiResponse }
> {
  if (config.authMethod === 'api-key') {
    return {
      ok: true,
      headers: new Headers({
        'x-umami-api-key': config.apiKey,
      }),
    }
  }

  const cacheKey = getUmamiLoginCacheKey(baseUrl, config.username, config.password)
  if (!options?.forceRefresh) {
    const cachedToken = getCachedUmamiLoginToken(cacheKey)
    if (cachedToken) {
      return {
        ok: true,
        headers: new Headers({
          Authorization: `Bearer ${cachedToken}`,
        }),
        cacheKey,
        usedCachedToken: true,
      }
    }
  }

  const loginResponse = await fetchJson(buildUmamiUrl(baseUrl, 'auth/login'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Arche Umami Connector',
    },
    body: JSON.stringify({
      username: config.username,
      password: config.password,
    }),
  })

  if (!loginResponse.ok) {
    return {
      ok: false,
      response:
        loginResponse.status === 401 || loginResponse.status === 403
          ? {
              ...loginResponse,
              message: `Umami authentication failed (${loginResponse.status}). Check the username and password.`,
            }
          : loginResponse,
    }
  }

  const token = isRecord(loginResponse.data) ? getString(loginResponse.data.token) : undefined
  if (!token) {
    return {
      ok: false,
      response: {
        ok: false,
        error: 'umami_auth_failed',
        message: 'Umami login succeeded without returning an access token.',
        status: 502,
        headers: loginResponse.headers,
        data: loginResponse.data,
      },
    }
  }

  setCachedUmamiLoginToken(cacheKey, token)

  return {
    ok: true,
    headers: new Headers({
      Authorization: `Bearer ${token}`,
    }),
    cacheKey,
    usedCachedToken: false,
  }
}

async function executeUmamiRequest(
  input: RequestUmamiJsonInput,
  baseUrl: string,
  headers: Headers
): Promise<UmamiApiResponse> {
  const requestHeaders = new Headers(headers)
  requestHeaders.set('Accept', 'application/json')
  requestHeaders.set('User-Agent', 'Arche Umami Connector')

  let body: string | undefined
  if (input.body !== undefined) {
    requestHeaders.set('Content-Type', 'application/json')
    body = JSON.stringify(input.body)
  }

  const url = buildUmamiUrl(baseUrl, input.path)
  if (input.searchParams) {
    url.search = input.searchParams.toString()
  }

  return fetchJson(url, {
    method: input.method ?? 'GET',
    headers: requestHeaders,
    body,
  })
}

export async function requestUmamiJson(input: RequestUmamiJsonInput): Promise<UmamiApiResponse> {
  const baseUrl = await resolveValidatedBaseUrl(input.config)
  if (!baseUrl.ok) return baseUrl

  const auth = await buildAuthHeaders(input.config, baseUrl.data)
  if (!auth.ok) return auth.response

  const response = await executeUmamiRequest(input, baseUrl.data, auth.headers)
  if (
    input.config.authMethod !== 'login'
    || !auth.usedCachedToken
    || (response.status !== 401 && response.status !== 403)
  ) {
    return response
  }

  clearCachedUmamiLoginToken(auth.cacheKey)

  const refreshedAuth = await buildAuthHeaders(input.config, baseUrl.data, { forceRefresh: true })
  if (!refreshedAuth.ok) return refreshedAuth.response

  return executeUmamiRequest(input, baseUrl.data, refreshedAuth.headers)
}

export async function testUmamiConnection(config: UmamiConnectorConfig): Promise<UmamiApiResponse> {
  return requestUmamiJson({
    config,
    path: 'websites',
    searchParams: new URLSearchParams({ pageSize: '1' }),
  })
}

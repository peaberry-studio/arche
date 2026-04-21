import { validateConnectorTestEndpoint } from '@/lib/security/ssrf'

import type { UmamiApiResponse, UmamiConnectorConfig } from '@/lib/connectors/umami-types'

const UMAMI_TIMEOUT_MS = 15_000

type RequestUmamiJsonInput = {
  config: UmamiConnectorConfig
  path: string
  method?: 'GET' | 'POST'
  searchParams?: URLSearchParams
  body?: unknown
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

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
  baseUrl: string
): Promise<{ ok: true; headers: Headers } | { ok: false; response: UmamiApiResponse }> {
  if (config.authMethod === 'api-key') {
    return {
      ok: true,
      headers: new Headers({
        'x-umami-api-key': config.apiKey,
      }),
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

  return {
    ok: true,
    headers: new Headers({
      Authorization: `Bearer ${token}`,
    }),
  }
}

export async function requestUmamiJson(input: RequestUmamiJsonInput): Promise<UmamiApiResponse> {
  const baseUrl = await resolveValidatedBaseUrl(input.config)
  if (!baseUrl.ok) return baseUrl

  const auth = await buildAuthHeaders(input.config, baseUrl.data)
  if (!auth.ok) return auth.response

  const headers = new Headers(auth.headers)
  headers.set('Accept', 'application/json')
  headers.set('User-Agent', 'Arche Umami Connector')

  let body: string | undefined
  if (input.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(input.body)
  }

  const url = buildUmamiUrl(baseUrl.data, input.path)
  if (input.searchParams) {
    url.search = input.searchParams.toString()
  }

  return fetchJson(url, {
    method: input.method ?? 'GET',
    headers,
    body,
  })
}

export async function testUmamiConnection(config: UmamiConnectorConfig): Promise<UmamiApiResponse> {
  return requestUmamiJson({
    config,
    path: 'websites',
    searchParams: new URLSearchParams({ pageSize: '1' }),
  })
}

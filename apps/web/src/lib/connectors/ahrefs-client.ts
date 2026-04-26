import { getString, isRecord } from '@/lib/connectors/connector-values'

import type { AhrefsApiResponse, AhrefsConnectorConfig } from '@/lib/connectors/ahrefs-types'

const AHREFS_API_BASE = 'https://api.ahrefs.com'
const AHREFS_TIMEOUT_MS = 15_000

function parseRetryAfter(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after')
  if (!retryAfter) return undefined

  const seconds = Number(retryAfter)
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : undefined
}

function extractAhrefsErrorDetail(payload: unknown): string | undefined {
  const payloadText = getString(payload)
  if (payloadText) {
    return payloadText
  }

  if (!isRecord(payload)) {
    return undefined
  }

  for (const key of ['error', 'message', 'detail']) {
    const value = getString(payload[key])
    if (value) return value
  }

  return undefined
}

function buildAhrefsUrl(path: string, searchParams?: Record<string, string>): URL {
  const url = new URL(`${AHREFS_API_BASE}${path}`)
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value)
      }
    }
  }
  return url
}

export async function requestAhrefsJson(input: {
  config: AhrefsConnectorConfig
  path: string
  searchParams?: Record<string, string>
}): Promise<AhrefsApiResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AHREFS_TIMEOUT_MS)

  try {
    const response = await fetch(buildAhrefsUrl(input.path, input.searchParams), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.config.apiKey}`,
        'User-Agent': 'Arche Ahrefs Connector',
      },
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
      const retryAfter = parseRetryAfter(response.headers)
      const detail = extractAhrefsErrorDetail(payload)
      return {
        ok: false,
        error: 'ahrefs_request_failed',
        message: detail
          ? `Ahrefs request failed (${response.status}): ${detail}`
          : `Ahrefs request failed (${response.status})`,
        status: response.status,
        headers: response.headers,
        data: payload,
        retryAfter,
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
      error: 'ahrefs_request_failed',
      message: `Ahrefs request failed: ${message}`,
      status: 0,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function testAhrefsConnection(config: AhrefsConnectorConfig): Promise<AhrefsApiResponse> {
  return requestAhrefsJson({
    config,
    path: '/v3/subscription-info/limits-and-usage',
  })
}

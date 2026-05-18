import { getE2eFakeProviderUrl } from '@/lib/e2e/runtime'

import type { ProviderId } from './types'

type ProviderAuthScheme = 'bearer' | 'x-api-key'

type ProviderRequestContext = {
  contentType: string
  method: string
  pathSegments: string[]
}

export type ProviderGatewayAdapter = {
  authScheme: ProviderAuthScheme
  baseUrl: () => string
  defaultHeaders?: Record<string, string>
  extractGatewayToken: (headers: Headers) => string | null
  maxFetchAttempts: (context: ProviderRequestContext) => number
  normalizeJsonPayload: (payload: unknown, context: ProviderRequestContext) => unknown
  shouldNormalizeJsonPayload: (context: ProviderRequestContext) => boolean
}

const OPENAI_RESPONSES_MAX_FETCH_ATTEMPTS = 3

const PROVIDER_BASE_URL: Record<ProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  opencode: 'https://opencode.ai/zen/v1',
}

const DEFAULT_PROVIDER_ADAPTER: Omit<ProviderGatewayAdapter, 'authScheme' | 'baseUrl' | 'extractGatewayToken'> = {
  maxFetchAttempts: () => 1,
  normalizeJsonPayload: (payload) => payload,
  shouldNormalizeJsonPayload: () => false,
}

function extractBearerToken(headers: Headers): string | null {
  const header = headers.get('authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function extractApiKey(headers: Headers): string | null {
  const apiKey = headers.get('x-api-key')
  return apiKey?.trim() || null
}

function extractOpencodeGatewayToken(headers: Headers): string | null {
  const bearerToken = extractBearerToken(headers)
  if (bearerToken) return bearerToken
  return extractApiKey(headers)
}

function openAiBaseUrl(): string {
  return getE2eFakeProviderUrl() ?? PROVIDER_BASE_URL.openai
}

function staticBaseUrl(providerId: ProviderId): () => string {
  return () => PROVIDER_BASE_URL[providerId]
}

function normalizeOpenAiResponsesPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }

  const body = payload as Record<string, unknown>
  let normalizedBody: Record<string, unknown> | null = null

  const ensureNormalizedBody = (): Record<string, unknown> => {
    if (normalizedBody) {
      return normalizedBody
    }
    normalizedBody = { ...body }
    return normalizedBody
  }

  const text = body.text

  if (text && typeof text === 'object' && !Array.isArray(text)) {
    const textObject = text as Record<string, unknown>
    if (textObject.verbosity === 'low') {
      ensureNormalizedBody().text = {
        ...textObject,
        verbosity: 'medium',
      }
    }
  }

  const reasoning = body.reasoning
  if (reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning)) {
    const reasoningObject = reasoning as Record<string, unknown>
    if (reasoningObject.effort === 'low') {
      ensureNormalizedBody().reasoning = {
        ...reasoningObject,
        effort: 'medium',
      }
    }
  }

  if (body.reasoning_effort === 'low') {
    ensureNormalizedBody().reasoning_effort = 'medium'
  }

  return normalizedBody ?? payload
}

function stripObjectKeys(payload: unknown, keysToStrip: ReadonlySet<string>): unknown {
  if (Array.isArray(payload)) {
    let changed = false
    const next = payload.map((value) => {
      const normalized = stripObjectKeys(value, keysToStrip)
      if (normalized !== value) {
        changed = true
      }
      return normalized
    })

    return changed ? next : payload
  }

  if (!payload || typeof payload !== 'object') {
    return payload
  }

  const record = payload as Record<string, unknown>
  let changed = false
  const nextEntries: Array<[string, unknown]> = []

  for (const [key, value] of Object.entries(record)) {
    if (keysToStrip.has(key)) {
      changed = true
      continue
    }

    const normalized = stripObjectKeys(value, keysToStrip)
    if (normalized !== value) {
      changed = true
    }
    nextEntries.push([key, normalized])
  }

  return changed ? Object.fromEntries(nextEntries) : payload
}

function normalizeFireworksPayload(payload: unknown): unknown {
  return stripObjectKeys(payload, new Set(['display_name']))
}

function isOpenAiResponsesRequest(context: ProviderRequestContext): boolean {
  return (
    context.method === 'POST' &&
    context.pathSegments[0] === 'responses' &&
    context.contentType.includes('application/json')
  )
}

function isFireworksJsonRequest(context: ProviderRequestContext): boolean {
  return context.contentType.includes('application/json')
}

const PROVIDER_ADAPTERS: Record<ProviderId, ProviderGatewayAdapter> = {
  openai: {
    ...DEFAULT_PROVIDER_ADAPTER,
    authScheme: 'bearer',
    baseUrl: openAiBaseUrl,
    extractGatewayToken: extractBearerToken,
    maxFetchAttempts: (context) => isOpenAiResponsesRequest(context) ? OPENAI_RESPONSES_MAX_FETCH_ATTEMPTS : 1,
    normalizeJsonPayload: normalizeOpenAiResponsesPayload,
    shouldNormalizeJsonPayload: isOpenAiResponsesRequest,
  },
  anthropic: {
    ...DEFAULT_PROVIDER_ADAPTER,
    authScheme: 'x-api-key',
    baseUrl: staticBaseUrl('anthropic'),
    defaultHeaders: { 'anthropic-version': '2023-06-01' },
    extractGatewayToken: extractApiKey,
  },
  fireworks: {
    ...DEFAULT_PROVIDER_ADAPTER,
    authScheme: 'bearer',
    baseUrl: staticBaseUrl('fireworks'),
    extractGatewayToken: extractBearerToken,
    normalizeJsonPayload: normalizeFireworksPayload,
    shouldNormalizeJsonPayload: isFireworksJsonRequest,
  },
  openrouter: {
    ...DEFAULT_PROVIDER_ADAPTER,
    authScheme: 'bearer',
    baseUrl: staticBaseUrl('openrouter'),
    extractGatewayToken: extractBearerToken,
  },
  opencode: {
    ...DEFAULT_PROVIDER_ADAPTER,
    authScheme: 'bearer',
    baseUrl: staticBaseUrl('opencode'),
    extractGatewayToken: extractOpencodeGatewayToken,
  },
}

export function getProviderGatewayAdapter(providerId: ProviderId): ProviderGatewayAdapter {
  return PROVIDER_ADAPTERS[providerId]
}

export function buildUpstreamUrl(base: string, path: string[] | string | undefined, requestUrl: URL): string {
  const segments = Array.isArray(path) ? [...path] : path ? [path] : []
  const upstream = new URL(base)
  const basePath = upstream.pathname === '/' ? '' : upstream.pathname.replace(/\/$/, '')

  if (segments.length > 0 && basePath.endsWith('/v1') && segments[0] === 'v1') {
    segments.shift()
  }

  const normalizedSuffix = segments.length > 0 ? `/${segments.join('/')}` : ''
  upstream.pathname = `${basePath}${normalizedSuffix}` || '/'
  upstream.search = requestUrl.search
  return upstream.toString()
}

export function applyProviderAuthHeaders(
  headers: Headers,
  adapter: ProviderGatewayAdapter,
  apiKey: string | null,
): boolean {
  if (adapter.authScheme === 'bearer') {
    if (apiKey) {
      headers.set('authorization', `Bearer ${apiKey}`)
    } else {
      headers.delete('authorization')
    }
    return true
  }

  if (!apiKey) {
    return false
  }

  headers.set('x-api-key', apiKey)
  for (const [name, value] of Object.entries(adapter.defaultHeaders ?? {})) {
    if (!headers.has(name)) {
      headers.set(name, value)
    }
  }
  return true
}

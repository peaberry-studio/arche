import { NextRequest, NextResponse } from 'next/server'
import { decryptProviderSecret } from '@/lib/providers/crypto'
import { getE2eFakeProviderUrl } from '@/lib/e2e/runtime'
import { getCanonicalProviderId } from '@/lib/providers/catalog'
import { getActiveCredentialForUser } from '@/lib/providers/store'
import { verifyGatewayToken } from '@/lib/providers/tokens'
import type { ProviderId } from '@/lib/providers/types'
import { checkRateLimit } from '@/lib/rate-limit'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROVIDER_BASE_URL: Record<ProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  opencode: 'https://opencode.ai/zen/v1',
}

function getProviderBaseUrl(providerId: ProviderId): string {
  if (providerId === 'openai') {
    const fakeProviderUrl = getE2eFakeProviderUrl()
    if (fakeProviderUrl) {
      return fakeProviderUrl
    }
  }

  return PROVIDER_BASE_URL[providerId]
}

const OPENAI_RESPONSES_MAX_FETCH_ATTEMPTS = 3
const OPENAI_RESPONSES_RETRY_DELAY_MS = 250
const RETRYABLE_FETCH_ERROR_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
])

const HOP_BY_HOP_HEADERS = [
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

function extractGatewayToken(providerId: ProviderId, headers: Headers): string | null {
  if (providerId === 'openai' || providerId === 'fireworks' || providerId === 'openrouter') {
    const header = headers.get('authorization')
    if (!header) return null
    const match = header.match(/^Bearer\s+(.+)$/i)
    return match?.[1]?.trim() || null
  }

  if (providerId === 'opencode') {
    const authHeader = headers.get('authorization')
    if (authHeader) {
      const match = authHeader.match(/^Bearer\s+(.+)$/i)
      const bearerToken = match?.[1]?.trim() || null
      if (bearerToken) return bearerToken
    }

    // OpenCode may send gateway credentials via x-api-key for some provider
    // formats (e.g. messages). Accept both to keep web/desktop behavior aligned.
    const apiKey = headers.get('x-api-key')
    return apiKey?.trim() || null
  }

  const apiKey = headers.get('x-api-key')
  return apiKey?.trim() || null
}

function buildUpstreamUrl(base: string, path: string[] | string | undefined, requestUrl: URL): string {
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
  // Fireworks rejects OpenCode metadata fields like `display_name` that are
  // not part of the OpenAI-compatible request schema.
  return stripObjectKeys(payload, new Set(['display_name']))
}

function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const directCode = (error as Error & { code?: string }).code
  if (directCode && RETRYABLE_FETCH_ERROR_CODES.has(directCode)) {
    return true
  }

  const causeCode = (error as Error & { cause?: { code?: string } }).cause?.code
  return Boolean(causeCode && RETRYABLE_FETCH_ERROR_CODES.has(causeCode))
}

function getFetchErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }

  const directCode = (error as Error & { code?: string }).code
  if (directCode) {
    return directCode
  }

  const causeCode = (error as Error & { cause?: { code?: string } }).cause?.code
  return causeCode ?? null
}

async function fetchWithRetry(url: string, init: RequestInit, maxAttempts: number): Promise<Response> {
  let attempt = 1

  while (true) {
    try {
      return await fetch(url, init)
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableFetchError(error)) {
        throw error
      }

      const backoffMs = OPENAI_RESPONSES_RETRY_DELAY_MS * attempt
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
      attempt += 1
    }
  }
}

function stripHopByHopHeaders(headers: Headers): void {
  const connectionHeader = headers.get('connection')
  if (connectionHeader) {
    for (const value of connectionHeader.split(',')) {
      const headerName = value.trim().toLowerCase()
      if (headerName) {
        headers.delete(headerName)
      }
    }
  }

  for (const headerName of HOP_BY_HOP_HEADERS) {
    headers.delete(headerName)
  }
}

async function handleProxy(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string; path?: string[] | string }> }
) {
  const { provider, path } = await params
  const pathSegments = Array.isArray(path) ? [...path] : path ? [path] : []
  const providerId = getCanonicalProviderId(provider)

  if (!providerId) {
    return NextResponse.json({ error: 'invalid_provider' }, { status: 400 })
  }

  const caps = getRuntimeCapabilities()
  const token = extractGatewayToken(providerId, request.headers)
  const allowAnonymousOpencode = providerId === 'opencode' && !caps.auth

  if (!token && !allowAnonymousOpencode) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: ReturnType<typeof verifyGatewayToken> | null = null
  let apiKey: string | null = null
  let allowExpiredGatewayTokenOpencodeFallback = false

  if (token) {
    try {
      payload = verifyGatewayToken(token)
    } catch (error) {
      if (providerId !== 'opencode') {
        return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
      }

      if (error instanceof Error && error.message === 'token_expired') {
        allowExpiredGatewayTokenOpencodeFallback = true
      } else {
        // When no Arche-managed credential is configured, OpenCode Zen may be
        // authenticated natively in the workspace. In that case, forward the
        // workspace token as-is.
        apiKey = token
      }
    }
  }

  if (payload) {
    const rateLimitKey = `provider-gw:${payload.userId}:${providerId}`
    const limit = checkRateLimit(rateLimitKey, 100, 60 * 1000)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: Math.ceil((limit.resetAt - Date.now()) / 1000) },
        { status: 429 }
      )
    }

    if (payload.providerId !== providerId) {
      return NextResponse.json({ error: 'provider_mismatch' }, { status: 403 })
    }

    const credential = await getActiveCredentialForUser({
      userId: payload.userId,
      providerId,
    })

    if (!credential) {
      if (providerId !== 'opencode') {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
    } else {
      if (payload && payload.version !== credential.version) {
        return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
      }

      if (credential.type !== 'api') {
        return NextResponse.json({ error: 'unsupported_credential' }, { status: 501 })
      }

      let secret: ReturnType<typeof decryptProviderSecret>
      try {
        secret = decryptProviderSecret(credential.secret)
      } catch {
        return NextResponse.json({ error: 'invalid_credentials' }, { status: 500 })
      }

      if (!('apiKey' in secret) || typeof secret.apiKey !== 'string' || !secret.apiKey.trim()) {
        return NextResponse.json({ error: 'unsupported_credential' }, { status: 501 })
      }

      apiKey = secret.apiKey.trim()
    }
  }

  const allowTokenAuthenticatedOpencodeWithoutCredential =
    providerId === 'opencode' && (Boolean(payload) || allowExpiredGatewayTokenOpencodeFallback)

  if (!apiKey && !allowAnonymousOpencode && !allowTokenAuthenticatedOpencodeWithoutCredential) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const upstreamUrl = buildUpstreamUrl(getProviderBaseUrl(providerId), pathSegments, new URL(request.url))

  const headers = new Headers(request.headers)
  stripHopByHopHeaders(headers)
  headers.delete('authorization')
  headers.delete('x-api-key')

  // Avoid content-encoding pass-through issues.
  // Node fetch will typically decompress upstream responses, but the upstream
  // headers may still include `content-encoding: gzip`, which would cause
  // downstream clients to attempt decoding a second time.
  headers.set('accept-encoding', 'identity')

  if (
    providerId === 'openai' ||
    providerId === 'fireworks' ||
    providerId === 'openrouter' ||
    providerId === 'opencode'
  ) {
    if (!apiKey) {
      headers.delete('authorization')
    } else {
      headers.set('authorization', `Bearer ${apiKey}`)
    }
  } else {
    if (!apiKey) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    headers.set('x-api-key', apiKey)
    if (!headers.has('anthropic-version')) {
      headers.set('anthropic-version', '2023-06-01')
    }
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
  }

  const contentType = headers.get('content-type') ?? ''
  const isOpenAiResponsesRequest =
    providerId === 'openai' &&
    request.method === 'POST' &&
    pathSegments[0] === 'responses' &&
    contentType.includes('application/json')
  const isFireworksJsonRequest = providerId === 'fireworks' && contentType.includes('application/json')

  if (hasBody) {
    if (isOpenAiResponsesRequest || isFireworksJsonRequest) {
      try {
        const parsedBody = await request.clone().json()
        const normalizedBody = isOpenAiResponsesRequest
          ? normalizeOpenAiResponsesPayload(parsedBody)
          : normalizeFireworksPayload(parsedBody)
        init.body = JSON.stringify(normalizedBody)
      } catch {
        init.body = await request.arrayBuffer()
      }
    } else {
      init.body = request.body
      init.duplex = 'half'
    }
  }

  const maxAttempts = isOpenAiResponsesRequest ? OPENAI_RESPONSES_MAX_FETCH_ATTEMPTS : 1

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetchWithRetry(upstreamUrl, init, maxAttempts)
  } catch (error) {
    console.error('[providers/gateway] upstream fetch failed', {
      provider: providerId,
      path: pathSegments.join('/'),
      code: getFetchErrorCode(error),
      message: error instanceof Error ? error.message : 'unknown_error',
    })
    return NextResponse.json({ error: 'provider_unavailable' }, { status: 502 })
  }

  const responseHeaders = new Headers(upstreamResponse.headers)

  // Ensure response headers match the returned body.
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  })
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string; path?: string[] | string }> }
) {
  return handleProxy(request, context)
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string; path?: string[] | string }> }
) {
  return handleProxy(request, context)
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ provider: string; path?: string[] | string }> }
) {
  return handleProxy(request, context)
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ provider: string; path?: string[] | string }> }
) {
  return handleProxy(request, context)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ provider: string; path?: string[] | string }> }
) {
  return handleProxy(request, context)
}

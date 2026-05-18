import { NextRequest, NextResponse } from 'next/server'

import { getCanonicalProviderId } from '@/lib/providers/catalog'
import { decryptProviderSecret } from '@/lib/providers/crypto'
import {
  applyProviderAuthHeaders,
  buildUpstreamUrl,
  getProviderGatewayAdapter,
} from '@/lib/providers/gateway-adapters'
import { fetchWithRetry, getFetchErrorCode } from '@/lib/providers/gateway-fetch'
import {
  markCredentialLastUsedBestEffort,
  recordProviderGatewayRequestBestEffort,
} from '@/lib/providers/gateway-usage'
import { getEffectiveCredentialForUser } from '@/lib/providers/store'
import { verifyGatewayToken } from '@/lib/providers/tokens'
import { checkRateLimit } from '@/lib/rate-limit'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import type { ProviderUsageCredentialSource } from '@/lib/services/provider-usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function extractRequestModelId(request: NextRequest, contentType: string): Promise<string | null> {
  if (request.method === 'GET' || request.method === 'HEAD' || !contentType.includes('application/json')) {
    return null
  }

  try {
    const payload: unknown = await request.clone().json()
    if (!isRecord(payload)) return null

    const directModel = payload.model
    if (typeof directModel === 'string' && directModel.trim()) {
      return directModel.trim()
    }

    if (isRecord(directModel)) {
      const modelId = directModel.modelId ?? directModel.modelID
      if (typeof modelId === 'string' && modelId.trim()) {
        return modelId.trim()
      }
    }
  } catch {
    return null
  }

  return null
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

  const adapter = getProviderGatewayAdapter(providerId)
  const caps = getRuntimeCapabilities()
  const token = adapter.extractGatewayToken(request.headers)
  const allowAnonymousOpencode = providerId === 'opencode' && !caps.auth

  if (!token && !allowAnonymousOpencode) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: ReturnType<typeof verifyGatewayToken> | null = null
  let apiKey: string | null = null
  let allowExpiredGatewayTokenOpencodeFallback = false
  let credentialSource: ProviderUsageCredentialSource | null = null

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

    const effectiveCredential = await getEffectiveCredentialForUser({
      userId: payload.userId,
      providerId,
    })

    if (!effectiveCredential) {
      if (providerId !== 'opencode') {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
      credentialSource = 'default'
    } else {
      const payloadCredentialSource = payload.credentialSource ?? 'user'
      const credential = effectiveCredential.credential

      if (payloadCredentialSource !== effectiveCredential.source) {
        return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
      }

      if (payload.credentialId && payload.credentialId !== credential.id) {
        return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
      }

      if (effectiveCredential.source === 'organization' && payload.credentialId !== credential.id) {
        return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
      }

      if (payload.version !== credential.version) {
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
      credentialSource = effectiveCredential.source
      const credentialId = credential.id
      markCredentialLastUsedBestEffort({ credentialId, source: credentialSource })
    }
  }

  const allowTokenAuthenticatedOpencodeWithoutCredential =
    providerId === 'opencode' && (Boolean(payload) || allowExpiredGatewayTokenOpencodeFallback)

  if (!apiKey && !allowAnonymousOpencode && !allowTokenAuthenticatedOpencodeWithoutCredential) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const upstreamUrl = buildUpstreamUrl(adapter.baseUrl(), pathSegments, new URL(request.url))

  const headers = new Headers(request.headers)
  stripHopByHopHeaders(headers)
  headers.delete('authorization')
  headers.delete('x-api-key')

  // Avoid content-encoding pass-through issues.
  // Node fetch will typically decompress upstream responses, but the upstream
  // headers may still include `content-encoding: gzip`, which would cause
  // downstream clients to attempt decoding a second time.
  headers.set('accept-encoding', 'identity')

  if (!applyProviderAuthHeaders(headers, adapter, apiKey)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
  }

  const contentType = headers.get('content-type') ?? ''
  const requestModelId = await extractRequestModelId(request, contentType)
  const requestContext = { contentType, method: request.method, pathSegments }

  if (hasBody) {
    if (adapter.shouldNormalizeJsonPayload(requestContext)) {
      try {
        const parsedBody = await request.clone().json()
        const normalizedBody = adapter.normalizeJsonPayload(parsedBody, requestContext)
        init.body = JSON.stringify(normalizedBody)
      } catch {
        init.body = await request.arrayBuffer()
      }
    } else {
      init.body = request.body
      init.duplex = 'half'
    }
  }

  const maxAttempts = adapter.maxFetchAttempts(requestContext)

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
    if (payload && credentialSource) {
      recordProviderGatewayRequestBestEffort({
        credentialSource,
        isError: true,
        modelId: requestModelId,
        providerId,
        userId: payload.userId,
      })
    }
    return NextResponse.json({ error: 'provider_unavailable' }, { status: 502 })
  }

  if (payload && credentialSource) {
    recordProviderGatewayRequestBestEffort({
      credentialSource,
      isError: upstreamResponse.status >= 400,
      modelId: requestModelId,
      providerId,
      userId: payload.userId,
    })
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

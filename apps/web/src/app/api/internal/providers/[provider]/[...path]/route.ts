import { NextRequest, NextResponse } from 'next/server'
import { decryptProviderSecret } from '@/lib/providers/crypto'
import { getActiveCredentialForUser } from '@/lib/providers/store'
import { verifyGatewayToken } from '@/lib/providers/tokens'
import { PROVIDERS, type ProviderId } from '@/lib/providers/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROVIDER_BASE_URL: Record<ProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
}

function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.includes(value as ProviderId)
}

function extractGatewayToken(providerId: ProviderId, headers: Headers): string | null {
  if (providerId === 'openai' || providerId === 'openrouter') {
    const header = headers.get('authorization')
    if (!header) return null
    const match = header.match(/^Bearer\s+(.+)$/i)
    return match?.[1]?.trim() || null
  }

  const apiKey = headers.get('x-api-key')
  return apiKey?.trim() || null
}

function buildUpstreamUrl(base: string, path: string[] | string | undefined, requestUrl: URL): string {
  const segments = Array.isArray(path) ? path : path ? [path] : []
  const suffix = segments.length > 0 ? `/${segments.join('/')}` : ''
  const upstream = new URL(base)
  const basePath = upstream.pathname === '/' ? '' : upstream.pathname.replace(/\/$/, '')
  upstream.pathname = `${basePath}${suffix}` || '/'
  upstream.search = requestUrl.search
  return upstream.toString()
}

async function handleProxy(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string; path?: string[] | string }> }
) {
  const { provider, path } = await params

  if (!isProviderId(provider)) {
    return NextResponse.json({ error: 'invalid_provider' }, { status: 400 })
  }

  const token = extractGatewayToken(provider, request.headers)
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: ReturnType<typeof verifyGatewayToken>
  try {
    payload = verifyGatewayToken(token)
  } catch {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
  }

  if (payload.providerId !== provider) {
    return NextResponse.json({ error: 'provider_mismatch' }, { status: 403 })
  }

  const credential = await getActiveCredentialForUser({
    userId: payload.userId,
    providerId: provider,
  })

  if (!credential) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
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

  const apiKey = secret.apiKey.trim()
  const upstreamUrl = buildUpstreamUrl(PROVIDER_BASE_URL[provider], path, new URL(request.url))

  const headers = new Headers(request.headers)
  headers.delete('authorization')
  headers.delete('x-api-key')

  // Avoid content-encoding pass-through issues.
  // Node fetch will typically decompress upstream responses, but the upstream
  // headers may still include `content-encoding: gzip`, which would cause
  // downstream clients to attempt decoding a second time.
  headers.set('accept-encoding', 'identity')

  if (provider === 'openai' || provider === 'openrouter') {
    headers.set('authorization', `Bearer ${apiKey}`)
  } else {
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
  if (hasBody) {
    init.body = request.body
    init.duplex = 'half'
  }

  const upstreamResponse = await fetch(upstreamUrl, init)
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

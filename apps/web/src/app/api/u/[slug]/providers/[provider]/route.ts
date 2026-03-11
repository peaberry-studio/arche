import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { validateSameOrigin } from '@/lib/csrf'
import { getSession } from '@/lib/runtime/session'
import { getInstanceUrl } from '@/lib/opencode/client'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { createApiCredential } from '@/lib/providers/store'
import { PROVIDERS, type ProviderId } from '@/lib/providers/types'
import { instanceService, providerService, userService } from '@/lib/services'

export interface CreateProviderCredentialRequest {
  apiKey: string
}

export interface ProviderCredentialResponse {
  id: string
  providerId: ProviderId
  type: string
  status: 'enabled' | 'disabled'
  version: number
}

export interface DisableProviderCredentialResponse {
  ok: true
  status: 'disabled' | 'missing'
}

function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.includes(value as ProviderId)
}

async function syncProviderAccessBestEffort(slug: string, userId: string): Promise<void> {
  try {
    const instance = await instanceService.findServerPasswordBySlug(slug)

    if (!instance) {
      return
    }

    const result = await syncProviderAccessForInstance({
      instance: {
        baseUrl: getInstanceUrl(slug),
        authHeader: `Basic ${Buffer.from(`opencode:${instance.serverPassword}`).toString('base64')}`,
      },
      slug,
      userId,
    })
    if (!result.ok && result.error !== 'instance_unavailable') {
      console.error('[providers] Failed to sync provider access', result.error)
    }
  } catch (error) {
    console.error('[providers] Failed to sync provider access', error)
  }
}

async function getProviderMutationContext(
  request: NextRequest,
  params: Promise<{ slug: string; provider: string }>
): Promise<
  | { ok: true; sessionUserId: string; provider: ProviderId; targetUserId: string; targetSlug: string }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const session = await getSession()
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    }
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  if (session.user.role !== 'ADMIN') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  const { slug, provider } = await params

  if (!isProviderId(provider)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_provider' }, { status: 400 }),
    }
  }

  const user = await userService.findIdBySlug(slug)

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'user_not_found' }, { status: 404 }),
    }
  }

  return {
    ok: true,
    sessionUserId: session.user.id,
    provider,
    targetUserId: user.id,
    targetSlug: slug,
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; provider: string }> }
): Promise<NextResponse<ProviderCredentialResponse | { error: string; message?: string }>> {
  const context = await getProviderMutationContext(request, params)
  if (!context.ok) {
    return context.response
  }

  let body: CreateProviderCredentialRequest
  try {
    body = await request.json()
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'Request body must be valid JSON' },
        { status: 400 }
      )
    }
    throw err
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Request body must be a JSON object' },
      { status: 400 }
    )
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!apiKey) {
    return NextResponse.json(
      { error: 'missing_fields', message: 'apiKey is required' },
      { status: 400 }
    )
  }

  const latest = await providerService.findLatestVersion(context.targetUserId, context.provider)

  const lastVersion = latest[0]?.version ?? 0
  const nextVersion = lastVersion + 1

  await providerService.disableAllForProvider(context.targetUserId, context.provider)

  const credential = await createApiCredential({
    userId: context.targetUserId,
    providerId: context.provider,
    apiKey,
    version: nextVersion,
  })

  await syncProviderAccessBestEffort(context.targetSlug, context.targetUserId)

  await auditEvent({
    actorUserId: context.sessionUserId,
    action: 'provider_credential.created',
    metadata: { providerId: context.provider, credentialId: credential.id },
  })

  return NextResponse.json(
    {
      id: credential.id,
      providerId: context.provider,
      type: credential.type,
      status: 'enabled',
      version: credential.version,
    },
    { status: 201 }
  )
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; provider: string }> }
): Promise<NextResponse<DisableProviderCredentialResponse | { error: string }>> {
  const context = await getProviderMutationContext(request, params)
  if (!context.ok) {
    return context.response
  }

  const result = await providerService.disableEnabledForProvider(context.targetUserId, context.provider)

  await syncProviderAccessBestEffort(context.targetSlug, context.targetUserId)

  await auditEvent({
    actorUserId: context.sessionUserId,
    action: 'provider_credential.disabled',
    metadata: {
      providerId: context.provider,
      disabledCount: result.count,
      targetSlug: context.targetSlug,
    },
  })

  return NextResponse.json({
    ok: true,
    status: result.count > 0 ? 'disabled' : 'missing',
  })
}

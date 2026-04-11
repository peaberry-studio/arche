import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { getInstanceUrl } from '@/lib/opencode/client'
import { syncProviderAccessForInstance } from '@/lib/opencode/providers'
import { replaceApiCredential } from '@/lib/providers/store'
import { PROVIDERS, type ProviderId } from '@/lib/providers/types'
import { withAuth } from '@/lib/runtime/with-auth'
import { instanceService, providerService, userService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'

export interface CreateProviderCredentialRequest {
  apiKey: string
}

export interface ProviderCredentialSummary {
  id: string
  providerId: ProviderId
  type: string
  status: 'enabled' | 'disabled'
  version: number
}

export interface CreateProviderCredentialResponse {
  credential: ProviderCredentialSummary
  restartRequired: boolean
}

export interface DisableProviderCredentialResponse {
  ok: true
  status: 'disabled' | 'missing'
  restartRequired: boolean
}

function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.includes(value as ProviderId)
}

async function syncProviderAccessBestEffort(slug: string, userId: string): Promise<boolean> {
  try {
    const instance = await instanceService.findCredentialsBySlug(slug)

    if (!instance || instance.status !== 'running') {
      await providerService.clearWorkspaceRestartRequired(userId)
      return false
    }

    const password = decryptPassword(instance.serverPassword)

    const result = await syncProviderAccessForInstance({
      instance: {
        baseUrl: getInstanceUrl(slug),
        authHeader: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      },
      slug,
      userId,
    })
    if (!result.ok && result.error !== 'instance_unavailable') {
      console.error('[providers] Failed to sync provider access', result.error)
      await providerService.markWorkspaceRestartRequired(userId)
      return true
    }

    await providerService.clearWorkspaceRestartRequired(userId)
  } catch (error) {
    console.error('[providers] Failed to sync provider access', error)
    await providerService.markWorkspaceRestartRequired(userId)
    return true
  }

  return false
}

async function getProviderMutationContext(
  user: { id: string; role: string },
  params: { slug: string; provider: string }
): Promise<
  | { ok: true; sessionUserId: string; provider: ProviderId; targetUserId: string; targetSlug: string }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  if (user.role !== 'ADMIN') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  const { slug, provider } = params

  if (!isProviderId(provider)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_provider' }, { status: 400 }),
    }
  }

  const targetUser = await userService.findIdBySlug(slug)

  if (!targetUser) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'user_not_found' }, { status: 404 }),
    }
  }

  return {
    ok: true,
    sessionUserId: user.id,
    provider,
    targetUserId: targetUser.id,
    targetSlug: slug,
  }
}

export const POST = withAuth<
  CreateProviderCredentialResponse | { error: string; message?: string },
  { slug: string; provider: string }
>({ csrf: true }, async (request: NextRequest, { user, params }) => {
  const context = await getProviderMutationContext(user, params)
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

  const credential = await replaceApiCredential({
    userId: context.targetUserId,
    providerId: context.provider,
    apiKey,
  })

  const restartRequired = await syncProviderAccessBestEffort(context.targetSlug, context.targetUserId)

  await auditEvent({
    actorUserId: context.sessionUserId,
    action: 'provider_credential.created',
    metadata: { providerId: context.provider, credentialId: credential.id },
  })

  return NextResponse.json(
    {
      credential: {
        id: credential.id,
        providerId: context.provider,
        type: credential.type,
        status: 'enabled',
        version: credential.version,
      },
      restartRequired,
    },
    { status: 201 }
  )
})

export const DELETE = withAuth<
  DisableProviderCredentialResponse | { error: string },
  { slug: string; provider: string }
>({ csrf: true }, async (_request: NextRequest, { user, params }) => {
  const context = await getProviderMutationContext(user, params)
  if (!context.ok) {
    return context.response
  }

  const result = await providerService.disableEnabledForProvider(context.targetUserId, context.provider)

  const restartRequired = await syncProviderAccessBestEffort(context.targetSlug, context.targetUserId)

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
    restartRequired,
    status: result.count > 0 ? 'disabled' : 'missing',
  })
})

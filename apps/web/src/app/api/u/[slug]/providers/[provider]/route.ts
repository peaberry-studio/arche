import { NextRequest, NextResponse } from 'next/server'

import { isProviderId } from '@/lib/providers/catalog'
import {
  disableUserProviderApiCredential,
  replaceUserProviderApiCredential,
} from '@/lib/providers/credential-mutations'
import type { ProviderId } from '@/lib/providers/types'
import { withAuth } from '@/lib/runtime/with-auth'
import { userService } from '@/lib/services'

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

  const result = await replaceUserProviderApiCredential({
    actorUserId: context.sessionUserId,
    providerId: context.provider,
    apiKey,
    targetSlug: context.targetSlug,
    targetUserId: context.targetUserId,
  })
  const { credential } = result

  return NextResponse.json(
    {
      credential: {
        id: credential.id,
        providerId: context.provider,
        type: credential.type,
        status: 'enabled',
        version: credential.version,
      },
      restartRequired: result.restartRequired,
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

  const result = await disableUserProviderApiCredential({
    actorUserId: context.sessionUserId,
    providerId: context.provider,
    targetSlug: context.targetSlug,
    targetUserId: context.targetUserId,
  })

  return NextResponse.json({
    ok: true,
    restartRequired: result.restartRequired,
    status: result.disabledCount > 0 ? 'disabled' : 'missing',
  })
})

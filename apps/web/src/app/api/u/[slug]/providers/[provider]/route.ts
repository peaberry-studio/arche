import { NextRequest, NextResponse } from 'next/server'

import { isProviderId } from '@/lib/providers/catalog'
import { decryptProviderSecret } from '@/lib/providers/crypto'
import {
  disableUserProviderApiCredential,
  replaceUserProviderCredential,
  replaceUserProviderApiCredential,
} from '@/lib/providers/credential-mutations'
import {
  createOllamaProviderSecret,
  isOllamaSecret,
  refreshOllamaProviderSecret,
  type OllamaDiscoveryError,
} from '@/lib/providers/ollama'
import { getActiveCredentialForUser } from '@/lib/providers/store'
import type { OllamaSecret, ProviderId } from '@/lib/providers/types'
import { withAuth } from '@/lib/runtime/with-auth'
import { userService } from '@/lib/services'

export interface CreateProviderCredentialRequest {
  apiKey?: string
  baseUrl?: string
  mode?: string
  refresh?: boolean
  token?: string
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

function getOllamaDiscoveryErrorResponse(error: OllamaDiscoveryError): NextResponse<{ error: string }> {
  if (error === 'invalid_url') {
    return NextResponse.json({ error: 'invalid_endpoint' }, { status: 400 })
  }

  if (error === 'blocked_url') {
    return NextResponse.json({ error: 'blocked_endpoint' }, { status: 400 })
  }

  if (error === 'missing_token') {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  return NextResponse.json({ error: 'ollama_discovery_failed' }, { status: 400 })
}

async function getRefreshedOllamaSecret(input: {
  providerId: ProviderId
  targetUserId: string
}): Promise<
  | { ok: true; secret: OllamaSecret }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const existing = await getActiveCredentialForUser({
    providerId: input.providerId,
    userId: input.targetUserId,
  })

  if (!existing) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'missing_credential' }, { status: 404 }),
    }
  }

  let secret: unknown
  try {
    secret = decryptProviderSecret(existing.secret)
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_credentials' }, { status: 500 }),
    }
  }

  if (!isOllamaSecret(secret)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unsupported_credential' }, { status: 501 }),
    }
  }

  const refreshed = await refreshOllamaProviderSecret(secret)
  if (!refreshed.ok) {
    return { ok: false, response: getOllamaDiscoveryErrorResponse(refreshed.error) }
  }

  return { ok: true, secret: refreshed.secret }
}

async function getOllamaSecretFromRequest(input: {
  body: CreateProviderCredentialRequest
  providerId: ProviderId
  targetUserId: string
}): Promise<
  | { ok: true; secret: OllamaSecret }
  | { ok: false; response: NextResponse<{ error: string; message?: string }> }
> {
  if (input.body.refresh === true) {
    return getRefreshedOllamaSecret({
      providerId: input.providerId,
      targetUserId: input.targetUserId,
    })
  }

  if (input.body.mode === 'local') {
    const baseUrl = typeof input.body.baseUrl === 'string' && input.body.baseUrl.trim()
      ? input.body.baseUrl.trim()
      : undefined
    const result = await createOllamaProviderSecret(baseUrl ? { baseUrl, mode: 'local' } : { mode: 'local' })

    if (!result.ok) {
      return { ok: false, response: getOllamaDiscoveryErrorResponse(result.error) }
    }

    return { ok: true, secret: result.secret }
  }

  if (input.body.mode === 'remote') {
    const baseUrl = typeof input.body.baseUrl === 'string' ? input.body.baseUrl.trim() : ''
    const apiKey = typeof input.body.token === 'string'
      ? input.body.token.trim()
      : typeof input.body.apiKey === 'string'
        ? input.body.apiKey.trim()
        : ''

    if (!baseUrl || !apiKey) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'missing_fields', message: 'baseUrl and token are required' },
          { status: 400 }
        ),
      }
    }

    const result = await createOllamaProviderSecret({ apiKey, baseUrl, mode: 'remote' })
    if (!result.ok) {
      return { ok: false, response: getOllamaDiscoveryErrorResponse(result.error) }
    }

    return { ok: true, secret: result.secret }
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: 'missing_fields', message: 'mode is required' },
      { status: 400 }
    ),
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

  if (context.provider === 'ollama') {
    const secretResult = await getOllamaSecretFromRequest({
      body,
      providerId: context.provider,
      targetUserId: context.targetUserId,
    })

    if (!secretResult.ok) {
      return secretResult.response
    }

    const result = await replaceUserProviderCredential({
      actorUserId: context.sessionUserId,
      providerId: context.provider,
      secret: secretResult.secret,
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

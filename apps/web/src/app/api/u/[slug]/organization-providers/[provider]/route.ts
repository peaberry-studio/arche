import { NextRequest, NextResponse } from 'next/server'

import { isProviderId } from '@/lib/providers/catalog'
import { decryptProviderSecret } from '@/lib/providers/crypto'
import {
  disableOrganizationProviderApiCredential,
  replaceOrganizationProviderApiCredential,
  replaceOrganizationProviderCredentialValue,
} from '@/lib/providers/credential-mutations'
import {
  createOllamaProviderSecret,
  isOllamaSecret,
  refreshOllamaProviderSecret,
  type OllamaDiscoveryError,
} from '@/lib/providers/ollama'
import { getActiveOrganizationCredential } from '@/lib/providers/store'
import type { OllamaSecret, ProviderId } from '@/lib/providers/types'
import { withAuth } from '@/lib/runtime/with-auth'

export type CreateOrganizationProviderCredentialRequest = {
  apiKey?: string
  baseUrl?: string
  mode?: string
  refresh?: boolean
  token?: string
}

export type OrganizationProviderCredentialSummary = {
  id: string
  providerId: ProviderId
  type: string
  status: 'enabled' | 'disabled'
  version: number
}

export type CreateOrganizationProviderCredentialResponse = {
  credential: OrganizationProviderCredentialSummary
}

export type DisableOrganizationProviderCredentialResponse = {
  ok: true
  status: 'disabled' | 'missing'
}

async function getOrganizationProviderMutationContext(
  user: { id: string; role: string },
  provider: string,
): Promise<
  | { ok: true; sessionUserId: string; provider: ProviderId }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  if (user.role !== 'ADMIN') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  if (!isProviderId(provider)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_provider' }, { status: 400 }),
    }
  }

  return { ok: true, sessionUserId: user.id, provider }
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

async function getRefreshedOrganizationOllamaSecret(providerId: ProviderId): Promise<
  | { ok: true; secret: OllamaSecret }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const existing = await getActiveOrganizationCredential(providerId)
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

async function getOrganizationOllamaSecretFromRequest(input: {
  body: CreateOrganizationProviderCredentialRequest
  providerId: ProviderId
}): Promise<
  | { ok: true; secret: OllamaSecret }
  | { ok: false; response: NextResponse<{ error: string; message?: string }> }
> {
  if (input.body.refresh === true) {
    return getRefreshedOrganizationOllamaSecret(input.providerId)
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
          { status: 400 },
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
      { status: 400 },
    ),
  }
}

export const POST = withAuth<
  CreateOrganizationProviderCredentialResponse | { error: string; message?: string },
  { slug: string; provider: string }
>({ csrf: true }, async (request: NextRequest, { user, params }) => {
  const context = await getOrganizationProviderMutationContext(user, params.provider)
  if (!context.ok) {
    return context.response
  }

  let body: CreateOrganizationProviderCredentialRequest
  try {
    body = await request.json()
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'Request body must be valid JSON' },
        { status: 400 },
      )
    }
    throw err
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Request body must be a JSON object' },
      { status: 400 },
    )
  }

  if (context.provider === 'ollama') {
    const secretResult = await getOrganizationOllamaSecretFromRequest({
      body,
      providerId: context.provider,
    })

    if (!secretResult.ok) {
      return secretResult.response
    }

    const result = await replaceOrganizationProviderCredentialValue({
      actorUserId: context.sessionUserId,
      providerId: context.provider,
      secret: secretResult.secret,
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
      },
      { status: 201 },
    )
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!apiKey) {
    return NextResponse.json(
      { error: 'missing_fields', message: 'apiKey is required' },
      { status: 400 },
    )
  }

  const result = await replaceOrganizationProviderApiCredential({
    actorUserId: context.sessionUserId,
    providerId: context.provider,
    apiKey,
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
    },
    { status: 201 },
  )
})

export const DELETE = withAuth<
  DisableOrganizationProviderCredentialResponse | { error: string },
  { slug: string; provider: string }
>({ csrf: true }, async (_request: NextRequest, { user, params }) => {
  const context = await getOrganizationProviderMutationContext(user, params.provider)
  if (!context.ok) {
    return context.response
  }

  const result = await disableOrganizationProviderApiCredential({
    actorUserId: context.sessionUserId,
    providerId: context.provider,
  })

  return NextResponse.json({
    ok: true,
    status: result.disabledCount > 0 ? 'disabled' : 'missing',
  })
})

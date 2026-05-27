import { NextRequest, NextResponse } from 'next/server'

import { isProviderId } from '@/lib/providers/catalog'
import {
  disableOrganizationProviderApiCredential,
  replaceOrganizationProviderApiCredential,
  replaceOrganizationProviderCredentialValue,
} from '@/lib/providers/credential-mutations'
import {
  getOllamaSecretFromRequest,
  type OllamaCredentialRequestBody,
  type OllamaCredentialRequestError,
} from '@/lib/providers/ollama-credential-request'
import { getActiveOrganizationCredential } from '@/lib/providers/store'
import type { ProviderId } from '@/lib/providers/types'
import { withAuth } from '@/lib/runtime/with-auth'

export type CreateOrganizationProviderCredentialRequest = OllamaCredentialRequestBody

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

function getOllamaCredentialErrorResponse(
  response: OllamaCredentialRequestError,
): NextResponse<{ error: string; message?: string }> {
  const body = response.message
    ? { error: response.error, message: response.message }
    : { error: response.error }

  return NextResponse.json(body, { status: response.status })
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
    const secretResult = await getOllamaSecretFromRequest({
      body,
      getExistingCredential: getActiveOrganizationCredential,
      providerId: context.provider,
    })

    if (!secretResult.ok) {
      return getOllamaCredentialErrorResponse(secretResult.response)
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

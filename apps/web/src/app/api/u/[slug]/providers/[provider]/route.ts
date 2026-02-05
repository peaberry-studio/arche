import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auditEvent, getAuthenticatedUser } from '@/lib/auth'
import { createApiCredential } from '@/lib/providers/store'
import { PROVIDERS, type ProviderId } from '@/lib/providers/types'

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

function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.includes(value as ProviderId)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; provider: string }> }
): Promise<NextResponse<ProviderCredentialResponse | { error: string; message?: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { slug, provider } = await params

  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!isProviderId(provider)) {
    return NextResponse.json({ error: 'invalid_provider' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
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

  const latest = await prisma.providerCredential.findMany({
    where: { userId: user.id, providerId: provider },
    select: { version: true },
    orderBy: { version: 'desc' },
    take: 1,
  })

  const lastVersion = latest[0]?.version ?? 0
  const nextVersion = lastVersion + 1

  await prisma.providerCredential.updateMany({
    where: { userId: user.id, providerId: provider },
    data: { status: 'disabled' },
  })

  const credential = await createApiCredential({
    userId: user.id,
    providerId: provider,
    apiKey,
    version: nextVersion,
  })

  await auditEvent({
    actorUserId: session.user.id,
    action: 'provider_credential.created',
    metadata: { providerId: provider, credentialId: credential.id },
  })

  return NextResponse.json(
    {
      id: credential.id,
      providerId: provider,
      type: credential.type,
      status: 'enabled',
      version: credential.version,
    },
    { status: 201 }
  )
}

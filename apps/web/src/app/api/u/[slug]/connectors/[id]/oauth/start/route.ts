import { NextRequest, NextResponse } from 'next/server'

import { auditEvent, getAuthenticatedUser } from '@/lib/auth'
import { isOAuthConnectorType, prepareConnectorOAuthAuthorization } from '@/lib/connectors/oauth'
import { validateConnectorType } from '@/lib/connectors/validators'
import { validateSameOrigin } from '@/lib/csrf'
import { getPublicBaseUrl } from '@/lib/http'
import { prisma } from '@/lib/prisma'

type StartOAuthResponse = {
  authorizeUrl: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
): Promise<NextResponse<StartOAuthResponse | { error: string; message?: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug, id } = await params
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const user = await prisma.user.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  }

  const connector = await prisma.connector.findFirst({
    where: { id, userId: user.id },
    select: { id: true, type: true },
  })
  if (!connector) {
    return NextResponse.json({ error: 'connector_not_found' }, { status: 404 })
  }

  if (!validateConnectorType(connector.type) || !isOAuthConnectorType(connector.type)) {
    return NextResponse.json({ error: 'oauth_not_supported' }, { status: 400 })
  }

  const baseUrl = getPublicBaseUrl(request.headers, request.nextUrl.origin)
  const redirectUri = `${baseUrl}/api/connectors/oauth/callback`
  let authorizeUrl: string
  try {
    const prepared = await prepareConnectorOAuthAuthorization({
      connectorId: connector.id,
      slug,
      userId: user.id,
      connectorType: connector.type,
      redirectUri,
    })
    authorizeUrl = prepared.authorizeUrl
  } catch (error) {
    const message = error instanceof Error ? error.message : 'oauth_start_failed'
    if (message.startsWith('oauth_discovery_failed')) {
      return NextResponse.json(
        {
          error: 'oauth_discovery_failed',
          message: 'Failed to discover OAuth endpoints for this MCP server.',
        },
        { status: 502 }
      )
    }

    if (message.startsWith('oauth_registration_failed')) {
      return NextResponse.json(
        {
          error: 'oauth_registration_failed',
          message: 'Dynamic client registration failed for this MCP server.',
        },
        { status: 502 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }

  await auditEvent({
    actorUserId: session.user.id,
    action: 'connector.oauth_started',
    metadata: { connectorId: connector.id, connectorType: connector.type },
  })

  return NextResponse.json({ authorizeUrl })
}

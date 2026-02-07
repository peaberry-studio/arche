import { NextRequest, NextResponse } from 'next/server'

import { auditEvent, getAuthenticatedUser } from '@/lib/auth'
import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import { buildConfigWithOAuth } from '@/lib/connectors/oauth-config'
import {
  exchangeConnectorOAuthCode,
  isOAuthConnectorType,
  verifyConnectorOAuthState,
} from '@/lib/connectors/oauth'
import { getPublicBaseUrl } from '@/lib/http'
import { validateConnectorType } from '@/lib/connectors/validators'
import { prisma } from '@/lib/prisma'

function buildRedirect(baseUrl: string, slug: string, status: 'success' | 'error', message?: string): URL {
  const url = new URL(`/u/${slug}/connectors`, baseUrl)
  url.searchParams.set('oauth', status)
  if (message) {
    url.searchParams.set('message', message)
  }
  return url
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const baseUrl = getPublicBaseUrl(request.headers, request.nextUrl.origin)
  const session = await getAuthenticatedUser()
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const providerError = request.nextUrl.searchParams.get('error')

  if (!state) {
    return NextResponse.json({ error: 'missing_state' }, { status: 400 })
  }

  let parsedState: ReturnType<typeof verifyConnectorOAuthState>
  try {
    parsedState = verifyConnectorOAuthState(state)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_state'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  if (!session) {
    return NextResponse.redirect(buildRedirect(baseUrl, parsedState.slug, 'error', 'unauthorized'))
  }

  if (session.user.slug !== parsedState.slug && session.user.role !== 'ADMIN') {
    return NextResponse.redirect(buildRedirect(baseUrl, parsedState.slug, 'error', 'forbidden'))
  }

  if (providerError) {
    await auditEvent({
      actorUserId: session.user.id,
      action: 'connector.oauth_failed',
      metadata: {
        connectorId: parsedState.connectorId,
        connectorType: parsedState.connectorType,
        error: providerError,
      },
    })
    return NextResponse.redirect(buildRedirect(baseUrl, parsedState.slug, 'error', providerError))
  }

  if (!code) {
    return NextResponse.redirect(buildRedirect(baseUrl, parsedState.slug, 'error', 'missing_code'))
  }

  const connector = await prisma.connector.findFirst({
    where: {
      id: parsedState.connectorId,
      userId: parsedState.userId,
    },
    select: {
      id: true,
      type: true,
      config: true,
    },
  })

  if (!connector || !validateConnectorType(connector.type) || !isOAuthConnectorType(connector.type)) {
    return NextResponse.redirect(buildRedirect(baseUrl, parsedState.slug, 'error', 'connector_not_found'))
  }

  const redirectUri = parsedState.redirectUri || `${baseUrl}/api/connectors/oauth/callback`
  try {
    if (!parsedState.clientId || !parsedState.codeVerifier || !parsedState.tokenEndpoint) {
      return NextResponse.redirect(buildRedirect(baseUrl, parsedState.slug, 'error', 'invalid_state'))
    }

    const token = await exchangeConnectorOAuthCode({
      code,
      redirectUri,
      state: parsedState,
    })

    const currentConfig = decryptConfig(connector.config)
    const nextConfig = buildConfigWithOAuth({
      connectorType: connector.type,
      currentConfig,
      oauth: {
        clientId: parsedState.clientId,
        clientSecret: parsedState.clientSecret,
        tokenEndpoint: parsedState.tokenEndpoint,
        authorizationEndpoint: parsedState.authorizationEndpoint,
        registrationEndpoint: parsedState.registrationEndpoint,
        issuer: parsedState.issuer,
        mcpServerUrl: parsedState.mcpServerUrl,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenType: token.tokenType,
        scope: token.scope,
        expiresAt: token.expiresAt,
      },
    })

    await prisma.connector.update({
      where: { id: connector.id },
      data: {
        config: encryptConfig(nextConfig),
        enabled: true,
      },
    })

    await auditEvent({
      actorUserId: session.user.id,
      action: 'connector.oauth_connected',
      metadata: {
        connectorId: connector.id,
        connectorType: connector.type,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'oauth_callback_failed'
    await auditEvent({
      actorUserId: session.user.id,
      action: 'connector.oauth_failed',
      metadata: {
        connectorId: parsedState.connectorId,
        connectorType: parsedState.connectorType,
        error: message,
      },
    })
    return NextResponse.redirect(buildRedirect(baseUrl, parsedState.slug, 'error', message))
  }

  return NextResponse.redirect(buildRedirect(baseUrl, parsedState.slug, 'success'))
}

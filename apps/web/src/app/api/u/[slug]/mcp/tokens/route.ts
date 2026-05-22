import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { generatePat, generatePatSalt, hashPat, hashPatLookup } from '@/lib/mcp/pat'
import { MCP_SCOPE_KB_READ, parseMcpScopes } from '@/lib/mcp/scopes'
import { withAuth } from '@/lib/runtime/with-auth'
import { mcpSettingsService, patService } from '@/lib/services'

type CreateTokenRequest = {
  expiresInDays?: unknown
  name?: unknown
  scopes?: unknown
}

type TokenListItem = {
  id: string
  name: string
  scopes: string[]
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
  user?: {
    id: string
    email: string
    slug: string
  }
}

type CreateTokenResponse = {
  token: string
  record: TokenListItem
}

export const GET = withAuth<{ tokens: TokenListItem[] } | { error: string }>(
  { csrf: false },
  async (_request, { user }) => {
    const tokens = user.role === 'ADMIN'
      ? await patService.findManyWithUsers()
      : await patService.findManyByUserId(user.id)

    return NextResponse.json({ tokens: tokens.map(serializeToken) })
  }
)

export const POST = withAuth<CreateTokenResponse | { error: string }>(
  { csrf: true },
  async (request: NextRequest, { user, slug }) => {
    if (user.slug !== slug) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const settings = await mcpSettingsService.getSettings()
    if (!settings.enabled) {
      return NextResponse.json({ error: 'mcp_disabled' }, { status: 403 })
    }

    const mcpAllowed = await mcpSettingsService.isUserAllowed(user.id)
    if (!mcpAllowed) {
      return NextResponse.json({ error: 'mcp_user_disallowed' }, { status: 403 })
    }

    let body: CreateTokenRequest
    try {
      body = await request.json()
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }
      throw error
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 80) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
    }

    const parsedScopes = parseMcpScopes(body.scopes ?? [MCP_SCOPE_KB_READ])
    if (!parsedScopes.ok || parsedScopes.scopes.length === 0) {
      return NextResponse.json({ error: 'invalid_scopes' }, { status: 400 })
    }

    const expiresInDays = parseExpiresInDays(body.expiresInDays)
    if (!expiresInDays) {
      return NextResponse.json({ error: 'invalid_expiration' }, { status: 400 })
    }

    const token = generatePat()
    const salt = generatePatSalt()
    const record = await patService.create({
      userId: user.id,
      name,
      lookupHash: hashPatLookup(token),
      tokenHash: hashPat(token, salt),
      salt,
      scopes: parsedScopes.scopes,
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
    })

    await auditEvent({
      actorUserId: user.id,
      action: 'mcp.token_created',
      metadata: { tokenId: record.id, scopes: record.scopes },
    })

    return NextResponse.json({ token, record: serializeToken(record) }, { status: 201 })
  }
)

function parseExpiresInDays(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : 30
  if (!Number.isFinite(numberValue) || numberValue < 1 || numberValue > 365) return null
  return Math.floor(numberValue)
}

function serializeToken(token: {
  id: string
  name: string
  scopes: string[]
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  user?: { id: string; email: string; slug: string }
}): TokenListItem {
  return {
    id: token.id,
    name: token.name,
    scopes: token.scopes,
    expiresAt: token.expiresAt.toISOString(),
    revokedAt: token.revokedAt?.toISOString() ?? null,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
    ...(token.user ? { user: token.user } : {}),
  }
}

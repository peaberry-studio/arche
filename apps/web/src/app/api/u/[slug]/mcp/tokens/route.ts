import { NextRequest, NextResponse } from 'next/server'

import { createUserMcpToken, listUserMcpTokens } from '@/lib/mcp/management-service'
import { MCP_SCOPE_KB_READ, parseMcpScopes } from '@/lib/mcp/scopes'
import type {
  CreateMcpTokenRequest,
  McpCreateTokenResponse,
  McpErrorResponse,
  McpTokenListResponse,
} from '@/lib/mcp/types'
import { serializeMcpToken } from '@/lib/mcp/types'
import { isRecord } from '@/lib/records'
import { withAuth } from '@/lib/runtime/with-auth'

export const GET = withAuth<McpTokenListResponse | McpErrorResponse>(
  { csrf: false },
  async (_request, { user, slug }) => {
    const result = await listUserMcpTokens({ actor: user, slug })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 })

    return NextResponse.json({ tokens: result.tokens.map(serializeMcpToken) })
  }
)

export const POST = withAuth<McpCreateTokenResponse | McpErrorResponse>(
  { csrf: true },
  async (request: NextRequest, { user, slug }) => {
    const body = await readCreateTokenRequest(request)
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 })

    const name = typeof body.data.name === 'string' ? body.data.name.trim() : ''
    if (!name || name.length > 80) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
    }

    const parsedScopes = parseMcpScopes(body.data.scopes ?? [MCP_SCOPE_KB_READ])
    if (!parsedScopes.ok || parsedScopes.scopes.length === 0) {
      return NextResponse.json({ error: 'invalid_scopes' }, { status: 400 })
    }

    const expiresInDays = parseExpiresInDays(body.data.expiresInDays)
    if (!expiresInDays) {
      return NextResponse.json({ error: 'invalid_expiration' }, { status: 400 })
    }

    const result = await createUserMcpToken({
      actor: user,
      expiresInDays,
      name,
      scopes: parsedScopes.scopes,
      slug,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: getCreateTokenErrorStatus(result.error) })
    }

    return NextResponse.json({ token: result.token, record: serializeMcpToken(result.record) }, { status: 201 })
  }
)

async function readCreateTokenRequest(request: NextRequest): Promise<
  | { ok: true; data: CreateMcpTokenRequest }
  | { ok: false; error: 'invalid_json' }
> {
  try {
    const body: unknown = await request.json()
    if (!isRecord(body)) return { ok: true, data: {} }

    return {
      ok: true,
      data: {
        expiresInDays: body.expiresInDays,
        name: body.name,
        scopes: body.scopes,
      },
    }
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, error: 'invalid_json' }
    throw error
  }
}

function parseExpiresInDays(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : 30
  if (!Number.isFinite(numberValue) || numberValue < 1 || numberValue > 365) return null
  return Math.floor(numberValue)
}

function getCreateTokenErrorStatus(error: string): number {
  return error === 'write_failed' ? 500 : 403
}

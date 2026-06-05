import { NextRequest, NextResponse } from 'next/server'

import { setAdminMcpUserAllowed } from '@/lib/mcp/management-service'
import type { McpErrorResponse, McpUpdateUserAccessResponse, UpdateMcpUserAccessRequest } from '@/lib/mcp/types'
import { isRecord } from '@/lib/records'
import { withGlobalAuth } from '@/lib/runtime/with-auth'

export const PATCH = withGlobalAuth<
  McpUpdateUserAccessResponse | McpErrorResponse,
  { id: string }
>(
  { csrf: true },
  async (request: NextRequest, { user, params }) => {
    const body = await readUpdateUserAccessRequest(request)
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 })
    if (typeof body.data.mcpAllowed !== 'boolean') {
      return NextResponse.json({ error: 'invalid_mcp_allowed' }, { status: 400 })
    }

    const result = await setAdminMcpUserAllowed({ actor: user, userId: params.id, mcpAllowed: body.data.mcpAllowed })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: getUpdateUserAccessErrorStatus(result.error) })

    return NextResponse.json({ user: result.user })
  }
)

function getUpdateUserAccessErrorStatus(error: string): number {
  return error === 'write_failed' ? 500 : 403
}

async function readUpdateUserAccessRequest(request: NextRequest): Promise<
  | { ok: true; data: UpdateMcpUserAccessRequest }
  | { ok: false; error: 'invalid_json' }
> {
  try {
    const body: unknown = await request.json()
    if (!isRecord(body)) return { ok: true, data: {} }

    return { ok: true, data: { mcpAllowed: body.mcpAllowed } }
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, error: 'invalid_json' }
    throw error
  }
}

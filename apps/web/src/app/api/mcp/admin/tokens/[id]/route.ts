import { NextResponse } from 'next/server'

import { revokeAdminMcpToken } from '@/lib/mcp/management-service'
import type { McpErrorResponse, McpOkResponse } from '@/lib/mcp/types'
import { withGlobalAuth } from '@/lib/runtime/with-auth'

export const DELETE = withGlobalAuth<McpOkResponse | McpErrorResponse, { id: string }>(
  { csrf: true },
  async (_request, { user, params }) => {
    const result = await revokeAdminMcpToken({ actor: user, tokenId: params.id })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: getRevokeTokenErrorStatus(result.error) })
    }

    return NextResponse.json({ ok: true })
  }
)

function getRevokeTokenErrorStatus(error: string): number {
  if (error === 'not_found') return 404
  if (error === 'write_failed') return 500

  return 403
}

import { NextResponse } from 'next/server'

import { revokeAdminMcpToken } from '@/lib/mcp/management-service'
import { mcpManagementErrorStatus } from '@/lib/mcp/types'
import type { McpErrorResponse, McpOkResponse } from '@/lib/mcp/types'
import { withGlobalAuth } from '@/lib/runtime/with-auth'

export const DELETE = withGlobalAuth<McpOkResponse | McpErrorResponse, { id: string }>(
  { csrf: true },
  async (_request, { user, params }) => {
    const result = await revokeAdminMcpToken({ actor: user, tokenId: params.id })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: mcpManagementErrorStatus(result.error) })
    }

    return NextResponse.json({ ok: true })
  }
)

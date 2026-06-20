import { NextResponse } from 'next/server'

import { revokeUserMcpToken } from '@/lib/mcp/management-service'
import { mcpManagementErrorStatus } from '@/lib/mcp/types'
import type { McpErrorResponse, McpOkResponse } from '@/lib/mcp/types'
import { withAuth } from '@/lib/runtime/with-auth'

export const DELETE = withAuth<McpOkResponse | McpErrorResponse, { slug: string; id: string }>(
  { csrf: true },
  async (_request, { user, params, slug }) => {
    const result = await revokeUserMcpToken({ actor: user, slug, tokenId: params.id })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: mcpManagementErrorStatus(result.error) })
    }

    return NextResponse.json({ ok: true })
  }
)

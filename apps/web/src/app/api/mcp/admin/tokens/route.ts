import { NextResponse } from 'next/server'

import { listAdminMcpTokens } from '@/lib/mcp/management-service'
import type { McpErrorResponse, McpTokenListResponse } from '@/lib/mcp/types'
import { serializeMcpToken } from '@/lib/mcp/types'
import { withGlobalAuth } from '@/lib/runtime/with-auth'

export const GET = withGlobalAuth<McpTokenListResponse | McpErrorResponse>(
  { csrf: false },
  async (_request, { user }) => {
    const result = await listAdminMcpTokens({ actor: user })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 })

    return NextResponse.json({ tokens: result.tokens.map(serializeMcpToken) })
  }
)

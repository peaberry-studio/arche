import { NextResponse } from 'next/server'

import { getUserMcpSettings } from '@/lib/mcp/management-service'
import type { McpErrorResponse, McpUserSettingsResponse } from '@/lib/mcp/types'
import { withAuth } from '@/lib/runtime/with-auth'

export const GET = withAuth<McpUserSettingsResponse | McpErrorResponse>(
  { csrf: false },
  async (_request, { user, slug }) => {
    const result = await getUserMcpSettings({ actor: user, slug })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 })

    return NextResponse.json({ enabled: result.enabled, mcpAllowed: result.mcpAllowed })
  }
)

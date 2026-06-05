import { NextRequest, NextResponse } from 'next/server'

import { getAdminMcpSettings, setAdminMcpEnabled } from '@/lib/mcp/management-service'
import type { McpAdminSettingsResponse, McpErrorResponse, UpdateMcpSettingsRequest } from '@/lib/mcp/types'
import { isRecord } from '@/lib/records'
import { withGlobalAuth } from '@/lib/runtime/with-auth'

export const GET = withGlobalAuth<McpAdminSettingsResponse | McpErrorResponse>(
  { csrf: false },
  async (_request, { user }) => {
    const result = await getAdminMcpSettings({ actor: user })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 })

    return NextResponse.json({ enabled: result.enabled, mcpAllowed: result.mcpAllowed, users: result.users })
  }
)

export const PATCH = withGlobalAuth<McpAdminSettingsResponse | McpErrorResponse>(
  { csrf: true },
  async (request: NextRequest, { user }) => {
    const body = await readUpdateSettingsRequest(request)
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 })
    if (typeof body.data.enabled !== 'boolean') {
      return NextResponse.json({ error: 'invalid_enabled' }, { status: 400 })
    }

    const result = await setAdminMcpEnabled({ actor: user, enabled: body.data.enabled })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: getUpdateSettingsErrorStatus(result.error) })

    return NextResponse.json({ enabled: result.enabled, mcpAllowed: result.mcpAllowed, users: result.users })
  }
)

function getUpdateSettingsErrorStatus(error: string): number {
  return error === 'write_failed' ? 500 : 403
}

async function readUpdateSettingsRequest(request: NextRequest): Promise<
  | { ok: true; data: UpdateMcpSettingsRequest }
  | { ok: false; error: 'invalid_json' }
> {
  try {
    const body: unknown = await request.json()
    if (!isRecord(body)) return { ok: true, data: {} }

    return { ok: true, data: { enabled: body.enabled } }
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, error: 'invalid_json' }
    throw error
  }
}

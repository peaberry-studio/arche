import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { withAuth } from '@/lib/runtime/with-auth'
import { mcpSettingsService } from '@/lib/services'

type UpdateUserAccessRequest = {
  mcpAllowed?: unknown
}

export const PATCH = withAuth<
  | { user: { id: string; email: string; slug: string; role: string; mcpAllowed: boolean } }
  | { error: string },
  { slug: string; id: string }
>(
  { csrf: true },
  async (request: NextRequest, { user, params, slug }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let body: UpdateUserAccessRequest
    try {
      body = await request.json()
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }
      throw error
    }

    if (typeof body.mcpAllowed !== 'boolean') {
      return NextResponse.json({ error: 'invalid_mcp_allowed' }, { status: 400 })
    }

    const updatedUser = await mcpSettingsService.setUserAllowed(params.id, body.mcpAllowed)
    await auditEvent({
      actorUserId: user.id,
      action: body.mcpAllowed ? 'mcp.user_allowed' : 'mcp.user_disallowed',
      metadata: { slug, userId: updatedUser.id, userSlug: updatedUser.slug },
    })

    return NextResponse.json({ user: updatedUser })
  }
)

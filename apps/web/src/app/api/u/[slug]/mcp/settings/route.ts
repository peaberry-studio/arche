import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { withAuth } from '@/lib/runtime/with-auth'
import { mcpSettingsService } from '@/lib/services'

type McpSettingsResponse = {
  enabled: boolean
  mcpAllowed: boolean
  users?: Array<{
    id: string
    email: string
    slug: string
    role: string
    mcpAllowed: boolean
  }>
}

type UpdateSettingsRequest = {
  enabled?: unknown
}

export const GET = withAuth<McpSettingsResponse | { error: string }>(
  { csrf: false },
  async (_request, { user }) => {
    const [settings, mcpAllowed] = await Promise.all([
      mcpSettingsService.getSettings(),
      mcpSettingsService.isUserAllowed(user.id),
    ])

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ enabled: settings.enabled, mcpAllowed })
    }

    const users = await mcpSettingsService.listUserAccess()
    return NextResponse.json({ enabled: settings.enabled, mcpAllowed, users })
  }
)

export const PATCH = withAuth<McpSettingsResponse | { error: string }>(
  { csrf: true },
  async (request: NextRequest, { user, slug }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let body: UpdateSettingsRequest
    try {
      body = await request.json()
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }
      throw error
    }

    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'invalid_enabled' }, { status: 400 })
    }

    const settings = await mcpSettingsService.setEnabled(body.enabled)
    await auditEvent({
      actorUserId: user.id,
      action: body.enabled ? 'mcp.enabled' : 'mcp.disabled',
      metadata: { slug },
    })

    const [mcpAllowed, users] = await Promise.all([
      mcpSettingsService.isUserAllowed(user.id),
      mcpSettingsService.listUserAccess(),
    ])
    return NextResponse.json({ enabled: settings.enabled, mcpAllowed, users })
  }
)

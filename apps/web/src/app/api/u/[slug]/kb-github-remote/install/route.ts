import { NextResponse } from 'next/server'

import { kbGithubRemoteService } from '@/lib/services'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'

function requireAdmin(user: { id: string; role: string }) {
  const denied = requireCapability('kbGithubSync')
  if (denied) {
    return { ok: false as const, response: denied }
  }

  if (user.role !== 'ADMIN') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return { ok: true as const }
}

export const GET = withAuth<{ error: string }>(
  { csrf: false },
  async (_request, { user, slug }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const record = await kbGithubRemoteService.findIntegration()
    if (!record) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    const config = kbGithubRemoteService.decryptIntegrationConfig(record)
    if (!config?.appId || !config?.privateKey || !config?.appSlug) {
      return NextResponse.json({ error: 'missing_app_slug' }, { status: 400 })
    }

    const installUrl = `https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new`

    return NextResponse.redirect(installUrl)
  },
)

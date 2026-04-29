import { NextResponse } from 'next/server'

import { getInstallationToken } from '@/lib/git/github-app-auth'
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

export const POST = withAuth<{ ok: boolean; message?: string } | { error: string }>(
  { csrf: true },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const record = await kbGithubRemoteService.findIntegration()
    if (!record) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    const config = kbGithubRemoteService.decryptIntegrationConfig(record)
    if (!config?.appId || !config?.privateKey) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    if (!record.state.installationId) {
      return NextResponse.json({ error: 'not_installed' }, { status: 400 })
    }

    const result = await getInstallationToken(config.appId, config.privateKey, record.state.installationId)

    if (result.ok) {
      return NextResponse.json({ ok: true, message: 'Connection successful — installation token acquired' })
    }

    return NextResponse.json({ ok: false, status: result.status, message: result.message })
  },
)

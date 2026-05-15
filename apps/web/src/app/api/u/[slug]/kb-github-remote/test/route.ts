import { NextResponse } from 'next/server'

import { getInstallationToken } from '@/lib/git/github-app-auth'
import { requireKbGithubRemoteAdmin } from '@/lib/kb-github-remote/route-auth'
import { withAuth } from '@/lib/runtime/with-auth'
import { kbGithubRemoteService } from '@/lib/services'

export const POST = withAuth<{ ok: boolean; message?: string } | { error: string }>(
  { csrf: true },
  async (_request, { user }) => {
    const admin = requireKbGithubRemoteAdmin(user)
    if (!admin.ok) return admin.response

    const record = await kbGithubRemoteService.findIntegration()
    const config = kbGithubRemoteService.decryptIntegrationConfig(record)
    if (!config?.appId || !config.privateKey) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }
    if (!record?.state.installationId) {
      return NextResponse.json({ error: 'not_installed' }, { status: 400 })
    }

    const result = await getInstallationToken(config.appId, config.privateKey, record.state.installationId)
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message })
    }

    return NextResponse.json({ ok: true, message: 'GitHub installation token acquired.' })
  },
)

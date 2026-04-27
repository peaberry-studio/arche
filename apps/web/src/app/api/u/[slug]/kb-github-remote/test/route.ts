import { NextResponse } from 'next/server'

import { testConnection } from '@/lib/git/kb-github-sync'
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

export const POST = withAuth<{ ok: boolean; remoteBranch?: string; status?: string; message?: string } | { error: string }>(
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
    if (!config?.repoUrl || !config?.pat) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    const result = await testConnection(config.repoUrl, config.pat)

    if (result.ok) {
      await kbGithubRemoteService.updateSyncState({
        remoteBranch: result.remoteBranch,
      })
    }

    return NextResponse.json(result)
  },
)

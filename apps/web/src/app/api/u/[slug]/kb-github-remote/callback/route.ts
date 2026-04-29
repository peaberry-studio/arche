import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { verifyInstallation } from '@/lib/git/github-app-auth'
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
  async (request: NextRequest, { user, slug }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const url = new URL(request.url)
    const installationIdRaw = url.searchParams.get('installation_id')

    if (!installationIdRaw) {
      return NextResponse.redirect(new URL(`/u/${slug}/settings/integrations/kb-github-remote?error=missing_installation_id`, request.url))
    }

    const installationId = Number(installationIdRaw)
    if (!Number.isFinite(installationId) || installationId <= 0) {
      return NextResponse.redirect(new URL(`/u/${slug}/settings/integrations/kb-github-remote?error=invalid_installation_id`, request.url))
    }

    const record = await kbGithubRemoteService.findIntegration()
    if (!record) {
      return NextResponse.redirect(new URL(`/u/${slug}/settings/integrations/kb-github-remote?error=not_configured`, request.url))
    }

    const config = kbGithubRemoteService.decryptIntegrationConfig(record)
    if (!config?.appId || !config?.privateKey) {
      return NextResponse.redirect(new URL(`/u/${slug}/settings/integrations/kb-github-remote?error=not_configured`, request.url))
    }

    const verification = await verifyInstallation(config.appId, config.privateKey, installationId)
    if (!verification.ok) {
      return NextResponse.redirect(new URL(`/u/${slug}/settings/integrations/kb-github-remote?error=verification_failed`, request.url))
    }

    await kbGithubRemoteService.updateSyncState({
      installationId,
    })

    await auditEvent({
      actorUserId: user.id,
      action: 'kb_github_remote.installed',
      metadata: { installationId, account: verification.account },
    })

    return NextResponse.redirect(new URL(`/u/${slug}/settings/integrations/kb-github-remote?installed=true`, request.url))
  },
)

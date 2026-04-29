import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { exchangeManifestCode } from '@/lib/git/github-app-auth'
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
    const code = url.searchParams.get('code')

    if (!code) {
      return NextResponse.redirect(
        new URL(`/u/${slug}/settings/integrations/kb-github-remote?error=missing_code`, request.url),
      )
    }

    const result = await exchangeManifestCode(code)
    if (!result.ok) {
      return NextResponse.redirect(
        new URL(`/u/${slug}/settings/integrations/kb-github-remote?error=exchange_failed`, request.url),
      )
    }

    await kbGithubRemoteService.saveIntegrationConfig({
      appId: String(result.appId),
      privateKey: result.pem,
      appSlug: result.slug,
    })

    await auditEvent({
      actorUserId: user.id,
      action: 'kb_github_remote.app_created',
      metadata: { appId: result.appId, appSlug: result.slug, owner: result.owner },
    })

    return NextResponse.redirect(
      new URL(`/u/${slug}/settings/integrations/kb-github-remote?app_created=true`, request.url),
    )
  },
)

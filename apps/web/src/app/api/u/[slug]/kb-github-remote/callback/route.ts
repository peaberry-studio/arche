import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { verifyInstallation } from '@/lib/git/github-app-auth'
import { requireKbGithubRemoteAdmin } from '@/lib/kb-github-remote/route-auth'
import {
  clearKbGithubRemoteSetupCookie,
  getKbGithubRemoteSetupSession,
  setRestoredSessionCookie,
} from '@/lib/kb-github-remote/setup-state'
import { kbGithubRemoteService } from '@/lib/services'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params
  const setupSession = await getKbGithubRemoteSetupSession(request, slug)
  if (!setupSession.ok) return redirectToManage(request.url, slug, setupSession.error)

  const admin = requireKbGithubRemoteAdmin(setupSession.user)
  if (!admin.ok) return redirectToManage(request.url, slug, 'forbidden')

  const url = new URL(request.url)
  const installationIdRaw = url.searchParams.get('installation_id')
  const installationId = installationIdRaw ? Number(installationIdRaw) : NaN
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    return redirectToManage(request.url, slug, 'invalid_installation_id')
  }

  const record = await kbGithubRemoteService.findIntegration()
  const config = kbGithubRemoteService.decryptIntegrationConfig(record)
  if (!config?.appId || !config.privateKey) {
    return redirectToManage(request.url, slug, 'not_configured')
  }

  const verification = await verifyInstallation(config.appId, config.privateKey, installationId)
  if (!verification.ok) {
    return redirectToManage(request.url, slug, 'verification_failed')
  }

  await kbGithubRemoteService.saveInstallation({
    account: verification.account,
    installationId,
  })

  await auditEvent({
    actorUserId: setupSession.user.id,
    action: 'kb_github_remote.installed',
    metadata: { account: verification.account, installationId },
  })

  const manageUrl = new URL(`/u/${slug}/settings/integrations/kb-github-remote`, request.url)
  manageUrl.searchParams.set('installed', 'true')
  const response = NextResponse.redirect(manageUrl)
  setRestoredSessionCookie(response, setupSession.restoredSessionCookie, request.headers)
  clearKbGithubRemoteSetupCookie(response, request.headers)
  return response
}

function redirectToManage(requestUrl: string, slug: string, error: string): NextResponse {
  const url = new URL(`/u/${slug}/settings/integrations/kb-github-remote`, requestUrl)
  url.searchParams.set('error', error)
  return NextResponse.redirect(url)
}

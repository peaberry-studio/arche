import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { exchangeManifestCode } from '@/lib/git/github-app-auth'
import { getPublicBaseUrl } from '@/lib/http'
import { requireKbGithubRemoteAdmin } from '@/lib/kb-github-remote/route-auth'
import {
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
  if (!setupSession.ok) return redirectToManage(request, slug, setupSession.error)

  const admin = requireKbGithubRemoteAdmin(setupSession.user)
  if (!admin.ok) return redirectToManage(request, slug, 'forbidden')

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (!code) {
    return redirectToManage(request, slug, 'missing_code')
  }

  const result = await exchangeManifestCode(code)
  if (!result.ok) {
    return redirectToManage(request, slug, 'exchange_failed')
  }

  await kbGithubRemoteService.saveAppConfig({
    appId: String(result.appId),
    appSlug: result.slug,
    privateKey: result.pem,
  })

  await auditEvent({
    actorUserId: setupSession.user.id,
    action: 'kb_github_remote.app_created',
    metadata: { appId: result.appId, appSlug: result.slug, owner: result.owner },
  })

  const installUrl = new URL(`https://github.com/apps/${encodeURIComponent(result.slug)}/installations/new`)
  const state = url.searchParams.get('state')
  if (state) installUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(installUrl)
  setRestoredSessionCookie(response, setupSession.restoredSessionCookie, request.headers)
  return response
}

function redirectToManage(request: NextRequest, slug: string, error: string): NextResponse {
  const baseUrl = getPublicBaseUrl(request.headers, request.url)
  const url = new URL(`/u/${slug}/settings/integrations/kb-github-remote`, baseUrl)
  url.searchParams.set('error', error)
  return NextResponse.redirect(url)
}

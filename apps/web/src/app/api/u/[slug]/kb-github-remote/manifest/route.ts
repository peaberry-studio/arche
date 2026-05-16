import { NextRequest, NextResponse } from 'next/server'

import { getPublicBaseUrl } from '@/lib/http'
import {
  createKbGithubRemoteSetupState,
  setKbGithubRemoteSetupCookie,
} from '@/lib/kb-github-remote/setup-state'
import { requireKbGithubRemoteAdmin } from '@/lib/kb-github-remote/route-auth'
import { getSession } from '@/lib/runtime/session'

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params
  const url = new URL(request.url)
  const owner = url.searchParams.get('owner')

  if (owner && !GITHUB_OWNER_PATTERN.test(owner)) {
    return NextResponse.redirect(
      new URL(`/u/${slug}/settings/integrations/kb-github-remote?error=invalid_owner`, request.url),
    )
  }

  const session = await getSession()
  if (!session) {
    return NextResponse.redirect(
      new URL(`/u/${slug}/settings/integrations/kb-github-remote?error=unauthorized`, request.url),
    )
  }

  const admin = requireKbGithubRemoteAdmin(session.user)
  if (!admin.ok) {
    return NextResponse.redirect(
      new URL(`/u/${slug}/settings/integrations/kb-github-remote?error=forbidden`, request.url),
    )
  }

  const state = createKbGithubRemoteSetupState({
    sessionId: session.sessionId,
    slug,
    userId: session.user.id,
  })

  const baseUrl = getPublicBaseUrl(request.headers, request.url)
  const manifest = {
    default_events: [],
    default_permissions: { contents: 'write', metadata: 'read' },
    name: 'Arche KB Sync',
    public: false,
    redirect_url: `${baseUrl}/api/u/${slug}/kb-github-remote/setup`,
    setup_url: `${baseUrl}/api/u/${slug}/kb-github-remote/callback?state=${encodeURIComponent(state)}`,
    url: baseUrl,
  }

  const actionUrl = owner
    ? `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/new`
    : 'https://github.com/settings/apps/new'

  const escapedManifest = JSON.stringify(manifest).replace(/</g, '\\u003c')
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Redirecting to GitHub…</title></head>
<body>
<form method="post" action="${actionUrl}?state=${encodeURIComponent(state)}">
<input type="hidden" name="manifest" value='${escapedManifest}'>
</form>
<script>document.forms[0].submit()</script>
</body>
</html>`

  const response = new Response(html, {
    headers: { 'content-type': 'text/html;charset=utf-8' },
  })
  setKbGithubRemoteSetupCookie(response, state, request.headers)
  return response
}

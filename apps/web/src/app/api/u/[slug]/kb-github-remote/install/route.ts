import { NextResponse } from 'next/server'

import { requireKbGithubRemoteAdmin } from '@/lib/kb-github-remote/route-auth'
import {
  createKbGithubRemoteSetupState,
  setKbGithubRemoteSetupCookie,
} from '@/lib/kb-github-remote/setup-state'
import { withAuth } from '@/lib/runtime/with-auth'
import { kbGithubRemoteService } from '@/lib/services'

export const GET = withAuth<{ error: string }>(
  { csrf: false },
  async (request, { sessionId, slug, user }) => {
    const admin = requireKbGithubRemoteAdmin(user)
    if (!admin.ok) return admin.response

    const record = await kbGithubRemoteService.findIntegration()
    const config = kbGithubRemoteService.decryptIntegrationConfig(record)
    if (!config?.appSlug) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    const state = createKbGithubRemoteSetupState({
      sessionId,
      slug,
      userId: user.id,
    })
    const installUrl = new URL(`https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new`)
    installUrl.searchParams.set('state', state)
    const response = NextResponse.redirect(installUrl)
    setKbGithubRemoteSetupCookie(response, state, request.headers)
    return response
  },
)

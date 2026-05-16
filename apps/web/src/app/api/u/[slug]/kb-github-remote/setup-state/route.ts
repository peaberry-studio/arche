import { NextRequest, NextResponse } from 'next/server'

import { requireKbGithubRemoteAdmin } from '@/lib/kb-github-remote/route-auth'
import {
  createKbGithubRemoteSetupState,
  setKbGithubRemoteSetupCookie,
} from '@/lib/kb-github-remote/setup-state'
import { withAuth } from '@/lib/runtime/with-auth'

type SetupStateResponse = {
  state: string
}

export const POST = withAuth<SetupStateResponse>(
  { csrf: true },
  async (request: NextRequest, { sessionId, slug, user }) => {
    const admin = requireKbGithubRemoteAdmin(user)
    if (!admin.ok) return admin.response

    const state = createKbGithubRemoteSetupState({
      sessionId,
      slug,
      userId: user.id,
    })
    const response = NextResponse.json({ state })
    setKbGithubRemoteSetupCookie(response, state, request.headers)

    return response
  },
)

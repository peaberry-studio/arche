import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import type { KbGithubRemoteIntegrationSummary } from '@/lib/kb-github-remote/types'
import { kbGithubRemoteService } from '@/lib/services'
import { withAuth } from '@/lib/runtime/with-auth'

import { requireAdmin } from './require-admin'

export const GET = withAuth<KbGithubRemoteIntegrationSummary | { error: string }>(
  { csrf: false },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const record = await kbGithubRemoteService.findIntegration()
    const config = record ? kbGithubRemoteService.decryptIntegrationConfig(record) : null

    return NextResponse.json(kbGithubRemoteService.toSummary(record, config))
  },
)

export const DELETE = withAuth<KbGithubRemoteIntegrationSummary | { error: string }>(
  { csrf: true },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const record = await kbGithubRemoteService.clearIntegration()

    await auditEvent({
      actorUserId: user.id,
      action: 'kb_github_remote.deleted',
    })

    return NextResponse.json(kbGithubRemoteService.toSummary(record, null))
  },
)

import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { finalizeSyncMerge } from '@/lib/git/kb-github-sync'
import { kbGithubRemoteService } from '@/lib/services'
import { withAuth } from '@/lib/runtime/with-auth'

import { requireAdmin } from '../../require-admin'

export const POST = withAuth(
  { csrf: true },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) return admin.response

    const result = await finalizeSyncMerge()
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    const now = new Date().toISOString()
    await kbGithubRemoteService.updateSyncState({
      lastSyncAt: now,
      lastPullAt: now,
      lastSyncStatus: 'success',
      lastError: null,
      hasPendingConflicts: false,
      remoteBranch: result.branch,
    })

    await auditEvent({
      actorUserId: user.id,
      action: 'kb_github_remote.conflicts_resolved',
      metadata: { commitHash: result.commitHash, branch: result.branch },
    })

    return NextResponse.json({ ok: true, commitHash: result.commitHash, branch: result.branch })
  },
)

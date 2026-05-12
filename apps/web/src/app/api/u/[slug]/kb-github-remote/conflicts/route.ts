import { NextResponse } from 'next/server'

import { abortSyncMerge, hasPendingSyncConflicts, listSyncConflicts } from '@/lib/git/kb-github-sync'
import { kbGithubRemoteService } from '@/lib/services'
import { withAuth } from '@/lib/runtime/with-auth'

import { requireAdmin } from '../require-admin'

export const GET = withAuth(
  { csrf: false },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) return admin.response

    const [files, hasPendingMerge] = await Promise.all([
      listSyncConflicts(),
      hasPendingSyncConflicts(),
    ])
    return NextResponse.json({ files, hasPendingMerge })
  },
)

export const DELETE = withAuth(
  { csrf: true },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) return admin.response

    await abortSyncMerge()

    await kbGithubRemoteService.updateSyncState({
      hasPendingConflicts: false,
      lastSyncStatus: null,
      lastError: null,
    })

    return NextResponse.json({ ok: true })
  },
)

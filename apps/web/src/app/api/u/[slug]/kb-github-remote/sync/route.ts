import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { pushToGithub, pullFromGithub } from '@/lib/git/kb-github-sync'
import type { KbGithubRemoteSyncState } from '@/lib/services/kb-github-remote'
import { kbGithubRemoteService } from '@/lib/services'
import { withAuth } from '@/lib/runtime/with-auth'

import { requireAdmin } from '../require-admin'

export const POST = withAuth(
  { csrf: true },
  async (request: NextRequest, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    const direction = body && typeof body === 'object' && 'direction' in body
      ? (body as { direction: unknown }).direction
      : null

    if (direction !== 'push' && direction !== 'pull') {
      return NextResponse.json({ error: 'invalid_direction' }, { status: 400 })
    }

    const record = await kbGithubRemoteService.findIntegration()
    if (!record) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    const config = kbGithubRemoteService.decryptIntegrationConfig(record)
    if (!config?.appId || !config?.privateKey) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    if (!record.state.installationId || !record.state.repoCloneUrl) {
      return NextResponse.json({ error: 'not_ready' }, { status: 400 })
    }

    const creds = {
      appId: config.appId,
      privateKey: config.privateKey,
      installationId: record.state.installationId,
      repoCloneUrl: record.state.repoCloneUrl,
    }

    const now = new Date().toISOString()
    const result = direction === 'push'
      ? await pushToGithub(creds)
      : await pullFromGithub(creds)

    const stateUpdate: Partial<KbGithubRemoteSyncState> = {
      lastSyncAt: now,
      lastSyncStatus: result.ok ? 'success' : (
        !result.ok && 'status' in result && result.status === 'conflicts' ? 'conflicts' : 'error'
      ),
      lastError: result.ok ? null : ('message' in result ? result.message : null),
      remoteBranch: result.ok && 'branch' in result ? result.branch : undefined,
    }

    if (direction === 'push') {
      stateUpdate.lastPushAt = now
    } else {
      stateUpdate.lastPullAt = now
    }

    await kbGithubRemoteService.updateSyncState(stateUpdate)

    await auditEvent({
      actorUserId: user.id,
      action: `kb_github_remote.${direction}`,
      metadata: { ok: result.ok, status: 'status' in result ? result.status : undefined },
    })

    return NextResponse.json(result)
  },
)

export const GET = withAuth(
  { csrf: false },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const state = await kbGithubRemoteService.getSyncState()
    return NextResponse.json(state)
  },
)

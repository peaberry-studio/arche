import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { getInstallationRepos } from '@/lib/git/github-app-auth'
import type { KbGithubRemoteRepo } from '@/lib/kb-github-remote/types'
import { kbGithubRemoteService } from '@/lib/services'
import { withAuth } from '@/lib/runtime/with-auth'

import { requireAdmin } from '../require-admin'

export const GET = withAuth<{ repos: KbGithubRemoteRepo[] } | { error: string }>(
  { csrf: false },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const record = await kbGithubRemoteService.findIntegration()
    if (!record) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    const config = kbGithubRemoteService.decryptIntegrationConfig(record)
    if (!config?.appId || !config?.privateKey) {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }

    if (!record.state.installationId) {
      return NextResponse.json({ error: 'not_installed' }, { status: 400 })
    }

    const result = await getInstallationRepos(config.appId, config.privateKey, record.state.installationId)
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 502 })
    }

    return NextResponse.json({ repos: result.repos })
  },
)

export const PUT = withAuth<{ ok: boolean; repoFullName: string } | { error: string }>(
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

    const repoFullName = body && typeof body === 'object' && 'repoFullName' in body
      ? String((body as { repoFullName: unknown }).repoFullName)
      : null
    const repoCloneUrl = body && typeof body === 'object' && 'repoCloneUrl' in body
      ? String((body as { repoCloneUrl: unknown }).repoCloneUrl)
      : null

    if (!repoFullName || !repoCloneUrl) {
      return NextResponse.json({ error: 'missing_repo' }, { status: 400 })
    }

    await kbGithubRemoteService.updateSyncState({
      repoFullName,
      repoCloneUrl,
    })

    await auditEvent({
      actorUserId: user.id,
      action: 'kb_github_remote.repo_selected',
      metadata: { repoFullName },
    })

    return NextResponse.json({ ok: true, repoFullName })
  },
)

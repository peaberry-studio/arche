import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import type { KbGithubRemoteIntegrationGetResponse } from '@/lib/kb-github-remote/types'
import { kbGithubRemoteService } from '@/lib/services'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'

function requireAdmin(user: { id: string; role: string }) {
  const denied = requireCapability('kbGithubSync')
  if (denied) {
    return { ok: false as const, response: denied }
  }

  if (user.role !== 'ADMIN') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return { ok: true as const }
}

function serializeResponse(
  record: Awaited<ReturnType<typeof kbGithubRemoteService.findIntegration>>,
  config: { appId?: string; privateKey?: string; appSlug?: string } | null,
): KbGithubRemoteIntegrationGetResponse {
  const state = record?.state
  return {
    appId: config?.appId ?? null,
    appSlug: config?.appSlug ?? null,
    appConfigured: Boolean(config?.appId && config?.privateKey),
    hasPrivateKey: Boolean(config?.privateKey),
    installationId: state?.installationId ?? null,
    repoFullName: state?.repoFullName ?? null,
    ready: Boolean(config?.appId && config?.privateKey && state?.installationId && state?.repoCloneUrl),
    lastSyncAt: state?.lastSyncAt ?? null,
    lastSyncStatus:
      state?.lastSyncStatus === 'success' ||
      state?.lastSyncStatus === 'error' ||
      state?.lastSyncStatus === 'conflicts'
        ? state.lastSyncStatus
        : null,
    lastError: state?.lastError ?? null,
    remoteBranch: state?.remoteBranch ?? null,
    version: record?.version ?? 0,
    updatedAt: record?.updatedAt?.toISOString() ?? null,
  }
}

export const GET = withAuth<KbGithubRemoteIntegrationGetResponse | { error: string }>(
  { csrf: false },
  async (_request, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) {
      return admin.response
    }

    const record = await kbGithubRemoteService.findIntegration()
    const config = record ? kbGithubRemoteService.decryptIntegrationConfig(record) : null

    return NextResponse.json(serializeResponse(record, config))
  },
)

export const DELETE = withAuth<KbGithubRemoteIntegrationGetResponse | { error: string }>(
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

    return NextResponse.json(serializeResponse(record, null))
  },
)

import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { getInstallationRepos } from '@/lib/git/github-app-auth'
import { requireKbGithubRemoteAdmin } from '@/lib/kb-github-remote/route-auth'
import type { KbGithubRemoteRepo } from '@/lib/kb-github-remote/types'
import { withAuth } from '@/lib/runtime/with-auth'
import { kbGithubRemoteService } from '@/lib/services'

type JsonObject = Record<string, unknown>

export const GET = withAuth<{ repos: KbGithubRemoteRepo[] } | { error: string }>(
  { csrf: false },
  async (_request, { user }) => {
    const admin = requireKbGithubRemoteAdmin(user)
    if (!admin.ok) return admin.response

    const ready = await loadGitHubAppConfig()
    if (!ready.ok) return ready.response

    const repos = await getInstallationRepos(ready.config.appId, ready.config.privateKey, ready.installationId)
    if (!repos.ok) {
      return NextResponse.json({ error: repos.message }, { status: 502 })
    }

    return NextResponse.json({
      repos: repos.repos.map(({ defaultBranch, fullName, private: isPrivate }) => ({
        defaultBranch,
        fullName,
        private: isPrivate,
      })),
    })
  },
)

export const PUT = withAuth<{ ok: true; repoFullName: string } | { error: string }>(
  { csrf: true },
  async (request: NextRequest, { user }) => {
    const admin = requireKbGithubRemoteAdmin(user)
    if (!admin.ok) return admin.response

    const parsed = await parseJsonObject(request)
    if (!parsed.ok) return parsed.response

    const repoFullName = typeof parsed.body.repoFullName === 'string'
      ? parsed.body.repoFullName.trim()
      : ''
    if (!repoFullName) {
      return NextResponse.json({ error: 'missing_repo' }, { status: 400 })
    }

    const ready = await loadGitHubAppConfig()
    if (!ready.ok) return ready.response

    const repos = await getInstallationRepos(ready.config.appId, ready.config.privateKey, ready.installationId)
    if (!repos.ok) {
      return NextResponse.json({ error: repos.message }, { status: 502 })
    }

    const selected = repos.repos.find((repo) => repo.fullName === repoFullName)
    if (!selected) {
      return NextResponse.json({ error: 'repo_not_found' }, { status: 400 })
    }

    await kbGithubRemoteService.saveSelectedRepo({
      cloneUrl: selected.cloneUrl,
      defaultBranch: selected.defaultBranch,
      fullName: selected.fullName,
    })

    await auditEvent({
      actorUserId: user.id,
      action: 'kb_github_remote.repo_selected',
      metadata: { repoFullName: selected.fullName },
    })

    return NextResponse.json({ ok: true, repoFullName: selected.fullName })
  },
)

async function loadGitHubAppConfig(): Promise<
  | { ok: true; config: { appId: string; privateKey: string }; installationId: number }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const record = await kbGithubRemoteService.findIntegration()
  const config = kbGithubRemoteService.decryptIntegrationConfig(record)
  if (!config?.appId || !config.privateKey) {
    return { ok: false, response: NextResponse.json({ error: 'not_configured' }, { status: 400 }) }
  }
  if (!record?.state.installationId) {
    return { ok: false, response: NextResponse.json({ error: 'not_installed' }, { status: 400 }) }
  }

  return {
    ok: true,
    config: { appId: config.appId, privateKey: config.privateKey },
    installationId: record.state.installationId,
  }
}

async function parseJsonObject(request: NextRequest): Promise<
  | { ok: true; body: JsonObject }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, response: NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  }

  return { ok: true, body: body as JsonObject }
}

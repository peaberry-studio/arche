import { NextResponse } from 'next/server'

import { pushToGithub } from '@/lib/git/kb-github-sync'
import { isWorkspaceReachable } from '@/lib/runtime/workspace-host'
import { withAuth } from '@/lib/runtime/with-auth'
import { kbGithubRemoteService } from '@/lib/services'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export interface PublishKbResult {
  ok: boolean
  status: 'published' | 'nothing_to_publish' | 'push_rejected' | 'conflicts' | 'no_remote' | 'error'
  commitHash?: string
  files?: string[]
  message?: string
}

async function pushToGithubBestEffort(): Promise<void> {
  try {
    const creds = await kbGithubRemoteService.getSyncCredentials()
    if (!creds) return

    const result = await pushToGithub(creds)

    const now = new Date().toISOString()
    await kbGithubRemoteService.updateSyncState({
      lastSyncAt: now,
      lastPushAt: now,
      lastSyncStatus: result.ok ? 'success' : 'error',
      lastError: result.ok ? null : result.message,
      remoteBranch: result.ok && 'branch' in result ? result.branch : undefined,
    })
  } catch {
    // Best-effort: don't block publish response if GitHub is unreachable
  }
}

export const POST = withAuth<PublishKbResult | { error: string }>(
  { csrf: true },
  async (_request, { slug }) => {
    const reachable = await isWorkspaceReachable(slug)

    if (!reachable) {
      return NextResponse.json({ error: 'instance_not_running' }, { status: 409 })
    }

    try {
      const agent = await createWorkspaceAgentClient(slug)
      if (!agent) {
        return NextResponse.json({ error: 'instance_unavailable' }, { status: 409 })
      }

      const response = await fetch(`${agent.baseUrl}/kb/publish`, {
        method: 'POST',
        headers: {
          Authorization: agent.authHeader,
          Accept: 'application/json'
        },
        cache: 'no-store'
      })

      const data = await response.json().catch(() => null) as PublishKbResult | null
      if (!response.ok || !data) {
        const errorText = data?.message ?? `workspace_agent_http_${response.status}`
        return NextResponse.json({
          ok: false,
          status: 'error',
          message: errorText,
        })
      }

      if (data.ok && data.status === 'published') {
        await pushToGithubBestEffort()
      }

      return NextResponse.json(data)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return NextResponse.json({
        ok: false,
        status: 'error',
        message,
      })
    }
  }
)

import { NextResponse } from 'next/server'

import { isWorkspaceReachable } from '@/lib/runtime/workspace-host'
import { withAuth } from '@/lib/runtime/with-auth'
import { kbGithubRemoteService } from '@/lib/services'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export interface SyncKbResult {
  ok: boolean
  status: 'synced' | 'conflicts' | 'no_remote' | 'error'
  message?: string
  conflicts?: string[]
  githubSyncStatus?: string
}

export const POST = withAuth<SyncKbResult | { error: string }>(
  { csrf: true },
  async (_request, { slug }) => {
    const reachable = await isWorkspaceReachable(slug)

    if (!reachable) {
      return NextResponse.json({ error: 'instance_not_running' }, { status: 409 })
    }

    try {
      const githubResult = await kbGithubRemoteService.pullBestEffort()

      const agent = await createWorkspaceAgentClient(slug)
      if (!agent) {
        return NextResponse.json({ error: 'instance_unavailable' }, { status: 409 })
      }

      const response = await fetch(`${agent.baseUrl}/kb/sync`, {
        method: 'POST',
        headers: {
          Authorization: agent.authHeader,
          Accept: 'application/json'
        },
        cache: 'no-store'
      })

      const data = await response.json().catch(() => null) as SyncKbResult | null
      if (!response.ok || !data) {
        const errorText = data?.message ?? `workspace_agent_http_${response.status}`
        return NextResponse.json({
          ok: false,
          status: 'error',
          message: errorText,
          githubSyncStatus: githubResult.status,
        })
      }

      return NextResponse.json({
        ...data,
        githubSyncStatus: githubResult.status,
      })
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

export const GET = withAuth<{ hasConflicts: boolean; conflicts?: string[] } | { error: string }>(
  { csrf: false },
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

      const response = await fetch(`${agent.baseUrl}/kb/status`, {
        headers: {
          Authorization: agent.authHeader,
          Accept: 'application/json'
        },
        cache: 'no-store'
      })

      const data = await response.json().catch(() => null) as { ok?: boolean; hasConflicts?: boolean; conflicts?: string[]; error?: string } | null
      if (!response.ok || !data || data.ok === false) {
        const errorText = data?.error ?? `workspace_agent_http_${response.status}`
        return NextResponse.json({ error: errorText }, { status: 500 })
      }

      return NextResponse.json({
        hasConflicts: Boolean(data.hasConflicts),
        conflicts: data.conflicts && data.conflicts.length > 0 ? data.conflicts : undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }
)

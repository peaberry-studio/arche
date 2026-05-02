import { NextResponse } from 'next/server'

import { pullFromGithub } from '@/lib/git/kb-github-sync'
import { isWorkspaceReachable } from '@/lib/runtime/workspace-host'
import { withAuth } from '@/lib/runtime/with-auth'
import { kbGithubRemoteService } from '@/lib/services'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export interface SyncKbResult {
  ok: boolean
  status: 'synced' | 'conflicts' | 'no_remote' | 'error'
  message?: string
  conflicts?: string[]
}

async function pullFromGithubBestEffort(): Promise<void> {
  try {
    const creds = await kbGithubRemoteService.getSyncCredentials()
    if (!creds) return

    const result = await pullFromGithub(creds)

    const now = new Date().toISOString()
    await kbGithubRemoteService.updateSyncState({
      lastSyncAt: now,
      lastPullAt: now,
      lastSyncStatus: result.ok ? 'success' : (
        !result.ok && result.status === 'conflicts' ? 'conflicts' : 'error'
      ),
      lastError: result.ok ? null : result.message,
      remoteBranch: result.ok && 'branch' in result ? result.branch : undefined,
    })
  } catch {
    // Best-effort: don't block workspace sync if GitHub is unreachable
  }
}

export const POST = withAuth<SyncKbResult | { error: string }>(
  { csrf: true },
  async (_request, { slug }) => {
    const reachable = await isWorkspaceReachable(slug)

    if (!reachable) {
      return NextResponse.json({ error: 'instance_not_running' }, { status: 409 })
    }

    try {
      await pullFromGithubBestEffort()

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
        })
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

/**
 * GET /api/instances/[slug]/sync-kb
 * 
 * Gets current sync status (pending conflicts, etc.)
 */
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

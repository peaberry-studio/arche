import { NextResponse } from 'next/server'

import { isWorkspaceReachable } from '@/lib/runtime/workspace-host'
import { withAuth } from '@/lib/runtime/with-auth'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export interface SyncKbResult {
  ok: boolean
  status: 'synced' | 'conflicts' | 'no_remote' | 'error'
  message?: string
  conflicts?: string[]
}

/**
 * POST /api/instances/[slug]/sync-kb
 * 
 * Syncs the Knowledge Base in the user's workspace.
 * Runs git fetch + git merge from the `kb` remote.
 * 
 * Responses:
 * - 200 { ok: true, status: 'synced' } - Sync succeeded with no conflicts
 * - 200 { ok: true, status: 'conflicts', conflicts: [...] } - Conflicts need resolution
 * - 200 { ok: false, status: 'no_remote' } - `kb` remote does not exist
 * - 200 { ok: false, status: 'error', message: '...' } - Error during sync
 * - 401 - Not authenticated
 * - 403 - Not authorized for this instance
 * - 404 - Instance not found
 * - 409 - Instance is not running
 */
export const POST = withAuth<SyncKbResult | { error: string }>(
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

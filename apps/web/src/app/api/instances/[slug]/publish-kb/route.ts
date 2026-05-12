import { NextResponse } from 'next/server'

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
  githubSyncError?: string
  githubConflictFiles?: string[]
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

      if (data.ok && (data.status === 'published' || data.status === 'nothing_to_publish')) {
        const pushResult = await kbGithubRemoteService.pushBestEffort()

        if (pushResult.status === 'push_rejected') {
          const pullResult = await kbGithubRemoteService.pullBestEffort()

          if (pullResult.status === 'conflicts') {
            return NextResponse.json({
              ok: false,
              status: 'conflicts',
              message: `Merge conflicts in ${pullResult.conflictingFiles?.length ?? 0} file(s). Resolve them in the Review panel.`,
              githubConflictFiles: pullResult.conflictingFiles ?? [],
            } satisfies PublishKbResult)
          }

          if (pullResult.status === 'pulled' || pullResult.status === 'up_to_date') {
            const retryPush = await kbGithubRemoteService.pushBestEffort()
            if (retryPush.status === 'pushed' || retryPush.status === 'up_to_date') {
              await fetch(`${agent.baseUrl}/kb/sync`, {
                method: 'POST',
                headers: {
                  Authorization: agent.authHeader,
                  Accept: 'application/json'
                },
                cache: 'no-store'
              }).catch(() => undefined)
              return NextResponse.json(data)
            }
            return NextResponse.json({
              ok: false,
              status: 'push_rejected',
              message: retryPush.message ?? 'Push failed after pulling latest changes. Try again.',
            } satisfies PublishKbResult)
          }

          return NextResponse.json({
            ok: false,
            status: 'push_rejected',
            message: pullResult.message ?? pushResult.message ?? 'Remote has changes that could not be pulled automatically.',
          } satisfies PublishKbResult)
        }

        if (pushResult.status === 'error') {
          return NextResponse.json({
            ...data,
            githubSyncError: pushResult.message,
          })
        }
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

import { NextResponse } from 'next/server'

import { publishKnowledgeBasePaths, type PublishKbResult } from '@/lib/learning/publish-kb'
import { isWorkspaceReachable } from '@/lib/runtime/workspace-host'
import { withAuth } from '@/lib/runtime/with-auth'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export type { PublishKbResult } from '@/lib/learning/publish-kb'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parsePaths(body: unknown): string[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.paths)) return undefined
  return body.paths.filter((path): path is string => typeof path === 'string')
}

export const POST = withAuth<PublishKbResult | { error: string }>(
  { csrf: true },
  async (request, { slug, user }) => {
    const reachable = await isWorkspaceReachable(slug)

    if (!reachable) {
      return NextResponse.json({ error: 'instance_not_running' }, { status: 409 })
    }

    try {
      const agent = await createWorkspaceAgentClient(slug)
      if (!agent) {
        return NextResponse.json({ error: 'instance_unavailable' }, { status: 409 })
      }

      const body = await request.json().catch(() => null)
      const result = await publishKnowledgeBasePaths({
        slug,
        actorUserId: user.id,
        paths: parsePaths(body),
      })
      return NextResponse.json(result)
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
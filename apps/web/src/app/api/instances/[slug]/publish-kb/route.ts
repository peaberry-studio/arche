import { NextResponse } from 'next/server'

import { publishKnowledgeBasePaths, type PublishKbResult } from '@/lib/learning/publish-kb'
import { isWorkspaceReachable } from '@/lib/runtime/workspace-host'
import { withAuth } from '@/lib/runtime/with-auth'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export type { PublishKbResult } from '@/lib/learning/publish-kb'

export type OutgoingKbFilesResult = {
  ok: boolean
  files: string[]
  message?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

type ParsedPaths =
  | { ok: true; paths: string[] | undefined }
  | { ok: false }

// `paths` is optional, but when it is present it must be an array of
// strings: a malformed value must fail closed instead of silently falling
// back to publish-all.
function parsePaths(body: unknown): ParsedPaths {
  if (!isRecord(body) || !('paths' in body)) return { ok: true, paths: undefined }
  const paths = body.paths
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) {
    return { ok: false }
  }
  return { ok: true, paths }
}

export const GET = withAuth<OutgoingKbFilesResult | { error: string }>(
  // GET requests carry no Origin header, so the same-origin CSRF check only
  // applies to the mutating POST handler. Read-only and session-guarded.
  { csrf: false },
  async (_request, { slug }) => {
    const reachable = await isWorkspaceReachable(slug)

    if (!reachable) {
      return NextResponse.json({ error: 'instance_not_running' }, { status: 409 })
    }

    const agent = await createWorkspaceAgentClient(slug)
    if (!agent) {
      return NextResponse.json({ error: 'instance_unavailable' }, { status: 409 })
    }

    try {
      const response = await fetch(`${agent.baseUrl}/kb/outgoing`, {
        headers: {
          Authorization: agent.authHeader,
          Accept: 'application/json',
        },
        cache: 'no-store',
      })

      const data = await response.json().catch(() => null) as { files?: unknown } | null
      if (!response.ok || !data) {
        return NextResponse.json({
          ok: false,
          files: [],
          message: `workspace_agent_http_${response.status}`,
        })
      }

      return NextResponse.json({
        ok: true,
        files: Array.isArray(data.files) ? data.files.filter((file): file is string => typeof file === 'string') : [],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return NextResponse.json({ ok: false, files: [], message })
    }
  }
)

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
      const parsed = parsePaths(body)
      if (!parsed.ok) {
        return NextResponse.json({ error: 'invalid_paths' }, { status: 400 })
      }
      const result = await publishKnowledgeBasePaths({
        slug,
        actorUserId: user.id,
        paths: parsed.paths,
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

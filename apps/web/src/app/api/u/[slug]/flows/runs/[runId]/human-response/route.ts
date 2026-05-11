import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { resumeFlowRun } from '@/lib/flows/runner'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { userService } from '@/lib/services'

type FlowHumanResponseRouteParams = {
  runId: string
  slug: string
}

async function resolveUserIdForSlug(slug: string, contextUser: { id: string; slug: string }) {
  if (contextUser.slug === slug) return contextUser.id

  const owner = await userService.findIdBySlug(slug)
  return owner?.id ?? null
}

export const POST = withAuth<{ ok: true } | { error: string }, FlowHumanResponseRouteParams>(
  { csrf: true },
  async (request, { params: { runId }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const userId = await resolveUserIdForSlug(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    let body: unknown
    try {
      body = await request.json()
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }
      throw error
    }

    const response = body && typeof body === 'object' && !Array.isArray(body) && typeof (body as { response?: unknown }).response === 'string'
      ? (body as { response: string }).response
      : null
    if (response === null) {
      return NextResponse.json({ error: 'invalid_response' }, { status: 400 })
    }

    const result = await resumeFlowRun({ humanResponse: response, runId, userId })
    if (!result.ok) {
      const status = result.error === 'not_found'
        ? 404
        : result.error === 'flow_busy'
          ? 409
          : 400
      return NextResponse.json({ error: result.error }, { status })
    }

    await auditEvent({
      action: 'flows.run_human_response_submitted',
      actorUserId: user.id,
      metadata: { runId, slug },
    })

    return NextResponse.json({ ok: true }, { status: 202 })
  },
)

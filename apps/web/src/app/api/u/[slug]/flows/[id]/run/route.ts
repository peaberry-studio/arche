import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { triggerFlowNow } from '@/lib/flows/runner'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { userService } from '@/lib/services'

type FlowRunRouteParams = {
  id: string
  slug: string
}

async function resolveUserIdForSlug(slug: string, contextUser: { id: string; slug: string }) {
  if (contextUser.slug === slug) return contextUser.id

  const owner = await userService.findIdBySlug(slug)
  return owner?.id ?? null
}

export const POST = withAuth<{ ok: true } | { error: string }, FlowRunRouteParams>(
  { csrf: true },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const userId = await resolveUserIdForSlug(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const result = await triggerFlowNow({ flowId: id, trigger: 'manual', userId })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.error === 'flow_busy' ? 409 : 404 })
    }

    await auditEvent({
      action: 'flows.flow_manual_run_requested',
      actorUserId: user.id,
      metadata: { flowId: id, slug },
    })

    return NextResponse.json({ ok: true }, { status: 202 })
  },
)

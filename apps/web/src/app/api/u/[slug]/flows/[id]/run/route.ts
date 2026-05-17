import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { resolveFlowOwnerUserId } from '@/lib/flows/api'
import { triggerFlowNow } from '@/lib/flows/runner'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'

type FlowRunRouteParams = {
  id: string
  slug: string
}

export const POST = withAuth<{ ok: true } | { error: string }, FlowRunRouteParams>(
  { csrf: true },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const userId = await resolveFlowOwnerUserId(slug, user)
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

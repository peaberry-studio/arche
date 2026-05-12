import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { resolveFlowOwnerUserId } from '@/lib/flows/api'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService } from '@/lib/services'

type FlowCancelRunRouteParams = {
  runId: string
  slug: string
}

export const POST = withAuth<{ ok: true } | { error: string }, FlowCancelRunRouteParams>(
  { csrf: true },
  async (_request, { params: { runId }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const userId = await resolveFlowOwnerUserId(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const cancelled = await flowService.cancelRunByIdAndUserId(runId, userId, new Date())
    if (!cancelled) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    await auditEvent({
      action: 'flows.run_cancelled',
      actorUserId: user.id,
      metadata: { runId, slug },
    })

    return NextResponse.json({ ok: true })
  },
)

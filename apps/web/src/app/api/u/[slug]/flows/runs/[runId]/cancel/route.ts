import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { resolveFlowRouteContext } from '@/lib/flows/api'
import { createFlowActorScope } from '@/lib/flows/authorization'
import { canCancelFlowRun } from '@/lib/flows/permissions'
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

    const routeContext = await resolveFlowRouteContext(slug, user)
    if (!routeContext) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const scope = createFlowActorScope(user, routeContext.workspaceUserId)

    const run = await flowService.findRunByIdForScope(runId, scope)
    if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!canCancelFlowRun(user, run)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    const cancelled = user.role === 'ADMIN'
      ? await flowService.cancelRunById(runId, new Date())
      : await flowService.cancelRunByIdForScope(runId, createFlowActorScope(user, user.id), new Date())
    if (!cancelled) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    await auditEvent({
      action: 'flows.run_cancelled',
      actorUserId: user.id,
      metadata: { runId, slug },
    })

    return NextResponse.json({ ok: true })
  },
)

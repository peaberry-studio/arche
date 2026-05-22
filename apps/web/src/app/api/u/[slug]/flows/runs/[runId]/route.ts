import { NextResponse } from 'next/server'

import { resolveFlowRouteContext } from '@/lib/flows/api'
import { canViewFlowRun } from '@/lib/flows/permissions'
import { serializeFlowRun } from '@/lib/flows/serializers'
import type { FlowRunListItem } from '@/lib/flows/types'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService } from '@/lib/services'

type FlowRunDetailRouteParams = {
  runId: string
  slug: string
}

export const GET = withAuth<{ run: FlowRunListItem } | { error: string }, FlowRunDetailRouteParams>(
  { csrf: false },
  async (_request, { params: { runId }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const routeContext = await resolveFlowRouteContext(slug, user)
    if (!routeContext) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const run = await flowService.findRunByIdAndUserId(runId, routeContext.workspaceUserId)
    if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!canViewFlowRun(user, run)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    return NextResponse.json({ run: serializeFlowRun(run) })
  },
)

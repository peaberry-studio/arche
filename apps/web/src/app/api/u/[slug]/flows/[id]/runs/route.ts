import { NextResponse } from 'next/server'

import { resolveFlowRouteContext } from '@/lib/flows/api'
import { createFlowActorScope } from '@/lib/flows/authorization'
import { canManageFlow, canViewFlow, canViewFlowRun } from '@/lib/flows/permissions'
import { serializeFlowRun } from '@/lib/flows/serializers'
import type { FlowRunListItem } from '@/lib/flows/types'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService } from '@/lib/services'

type FlowRunsRouteParams = {
  id: string
  slug: string
}

export const GET = withAuth<{ runs: FlowRunListItem[] } | { error: string }, FlowRunsRouteParams>(
  { csrf: false },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const routeContext = await resolveFlowRouteContext(slug, user)
    if (!routeContext) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const scope = createFlowActorScope(user, routeContext.workspaceUserId)

    const flow = await flowService.findFlowByIdForScope(id, scope)
    if (!flow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!canViewFlow(user, flow)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const runScopeUserId = canManageFlow(user, flow) && user.role === 'ADMIN' ? flow.userId : user.id
    const runs = await flowService.listRunsByFlowIdForScope(
      id,
      createFlowActorScope(user, runScopeUserId),
    )
    return NextResponse.json({ runs: runs.filter((run) => canViewFlowRun(user, run)).map(serializeFlowRun) })
  },
)

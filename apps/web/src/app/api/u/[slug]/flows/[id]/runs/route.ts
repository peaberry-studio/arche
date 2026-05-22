import { NextResponse } from 'next/server'

import { resolveFlowOwnerUserId } from '@/lib/flows/api'
import { canManageFlow, canViewFlow } from '@/lib/flows/permissions'
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

    const userId = await resolveFlowOwnerUserId(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const flow = await flowService.findFlowByIdAndUserId(id, userId)
    if (!flow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!canViewFlow(user, flow)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const runs = await flowService.listRunsByFlowIdAndUserId(id, canManageFlow(user, flow) ? flow.userId : user.id)
    return NextResponse.json({ runs: runs.map(serializeFlowRun) })
  },
)

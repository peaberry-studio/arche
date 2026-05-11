import { NextResponse } from 'next/server'

import { serializeFlowRun } from '@/lib/flows/serializers'
import type { FlowRunListItem } from '@/lib/flows/types'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService, userService } from '@/lib/services'

type FlowRunsRouteParams = {
  id: string
  slug: string
}

async function resolveUserIdForSlug(slug: string, contextUser: { id: string; slug: string }) {
  if (contextUser.slug === slug) return contextUser.id

  const owner = await userService.findIdBySlug(slug)
  return owner?.id ?? null
}

export const GET = withAuth<{ runs: FlowRunListItem[] } | { error: string }, FlowRunsRouteParams>(
  { csrf: false },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const userId = await resolveUserIdForSlug(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const flow = await flowService.findFlowByIdAndUserId(id, userId)
    if (!flow) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const runs = await flowService.listRunsByFlowIdAndUserId(id, userId)
    return NextResponse.json({ runs: runs.map(serializeFlowRun) })
  },
)

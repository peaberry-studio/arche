import { NextResponse } from 'next/server'

import { serializeFlowRun } from '@/lib/flows/serializers'
import type { FlowRunListItem } from '@/lib/flows/types'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService, userService } from '@/lib/services'

type FlowRunDetailRouteParams = {
  runId: string
  slug: string
}

async function resolveUserIdForSlug(slug: string, contextUser: { id: string; slug: string }) {
  if (contextUser.slug === slug) return contextUser.id

  const owner = await userService.findIdBySlug(slug)
  return owner?.id ?? null
}

export const GET = withAuth<{ run: FlowRunListItem } | { error: string }, FlowRunDetailRouteParams>(
  { csrf: false },
  async (_request, { params: { runId }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const userId = await resolveUserIdForSlug(slug, user)
    if (!userId) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const run = await flowService.findRunByIdAndUserId(runId, userId)
    if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    return NextResponse.json({ run: serializeFlowRun(run) })
  },
)

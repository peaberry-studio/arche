import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { flowService, userService } from '@/lib/services'

type FlowCancelRunRouteParams = {
  runId: string
  slug: string
}

async function resolveUserIdForSlug(slug: string, contextUser: { id: string; slug: string }) {
  if (contextUser.slug === slug) return contextUser.id

  const owner = await userService.findIdBySlug(slug)
  return owner?.id ?? null
}

export const POST = withAuth<{ ok: true } | { error: string }, FlowCancelRunRouteParams>(
  { csrf: true },
  async (_request, { params: { runId }, slug, user }) => {
    const denied = requireCapability('flows')
    if (denied) return denied

    const userId = await resolveUserIdForSlug(slug, user)
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

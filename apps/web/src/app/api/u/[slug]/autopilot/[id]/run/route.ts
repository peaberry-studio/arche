import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { triggerAutopilotTaskNow } from '@/lib/autopilot/runner'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'
import { userService } from '@/lib/services'

type AutopilotRunRouteParams = {
  id: string
  slug: string
}

async function resolveUserIdForSlug(slug: string, contextUser: { id: string; slug: string }) {
  if (contextUser.slug === slug) {
    return contextUser.id
  }

  const owner = await userService.findIdBySlug(slug)
  return owner?.id ?? null
}

export const POST = withAuth<{ ok: true } | { error: string }, AutopilotRunRouteParams>(
  { csrf: true },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('autopilot')
    if (denied) return denied

    const userId = await resolveUserIdForSlug(slug, user)
    if (!userId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const result = await triggerAutopilotTaskNow({
      taskId: id,
      trigger: 'manual',
      userId,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === 'task_busy' ? 409 : 404 },
      )
    }

    await auditEvent({
      actorUserId: user.id,
      action: 'autopilot.task_manual_run_requested',
      metadata: {
        slug,
        taskId: id,
      },
    })

    return NextResponse.json({ ok: true }, { status: 202 })
  },
)

import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { resolveAutopilotWorkspaceUserId } from '@/lib/autopilot/route-auth'
import { triggerAutopilotTaskNow } from '@/lib/autopilot/runner'
import { requireCapability } from '@/lib/runtime/require-capability'
import { withAuth } from '@/lib/runtime/with-auth'

type AutopilotRunRouteParams = {
  id: string
  slug: string
}

export const POST = withAuth<{ ok: true } | { error: string }, AutopilotRunRouteParams>(
  { csrf: true },
  async (_request, { params: { id }, slug, user }) => {
    const denied = requireCapability('autopilot')
    if (denied) return denied

    const userId = await resolveAutopilotWorkspaceUserId(slug, user)
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

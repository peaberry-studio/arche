import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { cancelLearningRun, findLearningRunForUser } from '@/lib/learning/service'
import { createInstanceClient } from '@/lib/opencode/client'
import { withAuth } from '@/lib/runtime/with-auth'
import { messageRunService } from '@/lib/services'
import type { LearningRun } from '@/types/learning'

type CancelRunParams = {
  slug: string
  runId: string
}

async function abortInternalSessionBestEffort(slug: string, runId: string, sessionId: string): Promise<void> {
  const client = await createInstanceClient(slug).catch((error) => {
    console.warn('[learning/cancel] Failed to create OpenCode client', { error, runId, sessionId })
    return null
  })

  if (client) {
    await Promise.resolve(client.session.abort({ sessionID: sessionId })).catch((error) => {
      console.warn('[learning/cancel] Failed to abort OpenCode session', { error, runId, sessionId })
    })
  }

  await messageRunService.abortActiveRun(slug, sessionId).catch((error) => {
    console.warn('[learning/cancel] Failed to abort active message run', { error, runId, sessionId })
  })
}

export const POST = withAuth<{ run: LearningRun } | { error: string }, CancelRunParams>(
  { csrf: true },
  async (_request, context) => {
    const run = await findLearningRunForUser({ runId: context.params.runId, userId: context.user.id })
    if (!run) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    if (run.status !== 'pending' && run.status !== 'running') {
      return NextResponse.json({ error: 'run_not_cancelable' }, { status: 400 })
    }

    const cancelledRun = await cancelLearningRun({ runId: run.id, userId: context.user.id })
    if (!cancelledRun) {
      return NextResponse.json({ error: 'run_not_cancelable' }, { status: 400 })
    }

    if (run.internalSessionId) {
      await abortInternalSessionBestEffort(context.slug, run.id, run.internalSessionId)
    }

    await auditEvent({
      actorUserId: context.user.id,
      action: 'learning.run_cancelled',
      metadata: {
        internalSessionId: run.internalSessionId,
        runId: run.id,
        sourceSessionId: run.sourceSessionId,
      },
    })

    return NextResponse.json({ run: cancelledRun })
  }
)

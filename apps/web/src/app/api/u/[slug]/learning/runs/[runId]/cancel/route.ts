import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { cancelLearningRun, findLearningRunForUser } from '@/lib/learning/service'
import { createInstanceClient } from '@/lib/opencode/client'
import { abortSessionFamilyAndConfirmIdle } from '@/lib/opencode/session-execution'
import { withAuth } from '@/lib/runtime/with-auth'
import { messageRunService } from '@/lib/services'
import type { LearningRun } from '@/types/learning'

type CancelRunParams = {
  slug: string
  runId: string
}

function cancellationLogError(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'unknown_error'
}

async function abortInternalSessionBestEffort(slug: string, runId: string, sessionId: string): Promise<boolean> {
  const client = await createInstanceClient(slug).catch((error) => {
    console.warn('[learning/cancel] Failed to create OpenCode client', { error: cancellationLogError(error), runId })
    return null
  })

  if (!client) return false

  const terminated = await abortSessionFamilyAndConfirmIdle({ client, rootSessionId: sessionId }).catch((error) => {
    console.warn('[learning/cancel] Failed to terminate OpenCode session family', {
      error: cancellationLogError(error),
      runId,
    })
    return false
  })
  if (!terminated) {
    console.warn('[learning/cancel] OpenCode session family could not be confirmed idle', { runId })
    return false
  }

  await messageRunService.abortActiveRun(slug, sessionId).catch((error) => {
    console.warn('[learning/cancel] Failed to abort active message run', { error: cancellationLogError(error), runId })
  })
  return true
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

    const internalSessionId = cancelledRun.internalSessionId ?? run.internalSessionId

    if (internalSessionId) {
      await abortInternalSessionBestEffort(context.slug, run.id, internalSessionId)
    }

    await auditEvent({
      actorUserId: context.user.id,
      action: 'learning.run_cancelled',
      metadata: {
        internalSessionId,
        runId: run.id,
        sourceSessionId: run.sourceSessionId,
      },
    })

    return NextResponse.json({ run: cancelledRun })
  }
)

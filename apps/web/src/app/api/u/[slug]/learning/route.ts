import { NextResponse } from 'next/server'

import {
  createLearningRun,
  dispatchLearningRunExecution,
  findLearningRunForUser,
  listKnowledgeReviewChanges,
  listLearningRuns,
} from '@/lib/learning/service'
import { withAuth } from '@/lib/runtime/with-auth'
import type { KnowledgeReviewChange, LearningRun } from '@/types/learning'

type LearningResponse = {
  proposals: KnowledgeReviewChange[]
  runs: LearningRun[]
}

type CreateLearningRunRequest = {
  sourceSessionId?: string
  title?: string
  runId?: string
}

export const GET = withAuth<LearningResponse | { error: string }>(
  { csrf: false },
  async (_request, context) => {
    const [runs, proposals] = await Promise.all([
      listLearningRuns(context.user.id),
      listKnowledgeReviewChanges(context.user.id),
    ])
    return NextResponse.json({ runs, proposals })
  }
)

export const POST = withAuth<{ run: LearningRun } | { error: string }>(
  { csrf: true },
  async (request, context) => {
    const body = (await request.json().catch(() => null)) as CreateLearningRunRequest | null

    // Retry: re-dispatch an existing run that never executed or failed.
    if (body?.runId) {
      const run = await findLearningRunForUser({ runId: body.runId, userId: context.user.id })
      if (!run) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      }
      if (run.status !== 'pending' && run.status !== 'failed') {
        return NextResponse.json({ error: 'run_not_retryable' }, { status: 400 })
      }

      dispatchLearningRunExecution({
        runId: run.id,
        slug: context.slug,
        userId: context.user.id,
        sourceSessionId: run.sourceSessionId,
        title: run.title,
        trigger: run.trigger,
      })
      return NextResponse.json({ run })
    }

    const result = await createLearningRun({
      userId: context.user.id,
      slug: context.slug,
      sourceSessionId: body?.sourceSessionId ?? null,
      title: body?.title,
      trigger: 'manual',
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    dispatchLearningRunExecution({
      runId: result.run.id,
      slug: context.slug,
      userId: context.user.id,
      sourceSessionId: result.run.sourceSessionId,
      title: result.run.title,
      trigger: 'manual',
    })
    return NextResponse.json({ run: result.run })
  }
)

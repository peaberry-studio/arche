import { NextResponse } from 'next/server'

import {
  createLearningRun,
  dispatchLearningRunExecution,
  findLearningRunForUser,
  listKnowledgeReviewChanges,
  listLearningRuns,
} from '@/lib/learning/service'
import { withAuth } from '@/lib/runtime/with-auth'
import { findIdBySlug } from '@/lib/services/user'
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
    // Review records and runs belong to the workspace owner. An ADMIN can view
    // another user's workspace, so the owner must be resolved from the slug
    // instead of assuming the acting user is the owner.
    const owner = await findIdBySlug(context.slug)
    if (!owner) {
      return NextResponse.json({ error: 'workspace_owner_not_found' }, { status: 400 })
    }
    const [runs, proposals] = await Promise.all([
      listLearningRuns(owner.id),
      listKnowledgeReviewChanges(owner.id),
    ])
    return NextResponse.json({ runs, proposals })
  }
)

export const POST = withAuth<{ run: LearningRun } | { error: string }>(
  { csrf: true },
  async (request, context) => {
    const body = (await request.json().catch(() => null)) as CreateLearningRunRequest | null

    // Runs belong to the workspace owner. An ADMIN can act on another user's
    // workspace, so the owner is resolved from the slug while the actor
    // remains the acting user.
    const owner = await findIdBySlug(context.slug)
    if (!owner) {
      return NextResponse.json({ error: 'workspace_owner_not_found' }, { status: 400 })
    }

    // Retry: re-dispatch an existing run that never executed or failed.
    if (body?.runId) {
      const run = await findLearningRunForUser({ runId: body.runId, userId: owner.id })
      if (!run) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      }
      if (run.status !== 'pending' && run.status !== 'failed') {
        return NextResponse.json({ error: 'run_not_retryable' }, { status: 400 })
      }

      dispatchLearningRunExecution({
        runId: run.id,
        slug: context.slug,
        userId: owner.id,
        sourceSessionId: run.sourceSessionId,
        title: run.title,
        trigger: run.trigger,
      })
      return NextResponse.json({ run })
    }

    const result = await createLearningRun({
      userId: owner.id,
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
      userId: owner.id,
      sourceSessionId: result.run.sourceSessionId,
      title: result.run.title,
      trigger: 'manual',
    })
    return NextResponse.json({ run: result.run })
  }
)

import { NextResponse } from 'next/server'

import {
  createLearningRun,
  listLearningProposals,
  listLearningRuns,
} from '@/lib/learning/service'
import { withAuth } from '@/lib/runtime/with-auth'
import type { LearningProposal, LearningRun } from '@/types/learning'

type LearningResponse = {
  proposals: LearningProposal[]
  runs: LearningRun[]
}

type CreateLearningRunRequest = {
  sourceSessionId?: string
  title?: string
}

export const GET = withAuth<LearningResponse | { error: string }>(
  { csrf: false },
  async (_request, context) => {
    const [runs, proposals] = await Promise.all([
      listLearningRuns(context.user.id),
      listLearningProposals(context.user.id),
    ])
    return NextResponse.json({ runs, proposals })
  }
)

export const POST = withAuth<{ run: LearningRun } | { error: string }>(
  { csrf: true },
  async (request, context) => {
    const body = (await request.json().catch(() => null)) as CreateLearningRunRequest | null
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
    return NextResponse.json({ run: result.run })
  }
)

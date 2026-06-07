import { NextResponse } from 'next/server'

import { applyLearningProposal, rejectLearningProposal } from '@/lib/learning/service'
import { withAuth } from '@/lib/runtime/with-auth'
import type { LearningProposal } from '@/types/learning'

type ProposalActionRequest = {
  action?: string
  content?: string
  proposalId?: string
}

export const POST = withAuth<{ proposal: LearningProposal } | { error: string }>(
  { csrf: true },
  async (request, context) => {
    const body = (await request.json().catch(() => null)) as ProposalActionRequest | null
    if (!body?.proposalId) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }

    if (body.action !== 'apply' && body.action !== 'reject') {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }

    const result = body.action === 'reject'
      ? await rejectLearningProposal({ userId: context.user.id, proposalId: body.proposalId })
      : await applyLearningProposal({
          userId: context.user.id,
          slug: context.slug,
          proposalId: body.proposalId,
          content: body.content,
        })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ proposal: result.proposal })
  }
)

import { NextResponse } from 'next/server'

import { applyLearningProposal, rejectLearningProposal } from '@/lib/learning/service'
import { parseProposalActionRequest } from '@/lib/learning/validation'
import { withAuth } from '@/lib/runtime/with-auth'
import type { LearningProposal } from '@/types/learning'

export const POST = withAuth<{ proposal: LearningProposal } | { error: string }>(
  { csrf: true },
  async (request, context) => {
    const body = await request.json().catch(() => null)
    const parsed = parseProposalActionRequest(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }

    const { action, proposalId, content } = parsed.value
    const result = action === 'reject'
      ? await rejectLearningProposal({ userId: context.user.id, proposalId })
      : await applyLearningProposal({
          userId: context.user.id,
          slug: context.slug,
          proposalId,
          content,
        })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ proposal: result.proposal })
  }
)

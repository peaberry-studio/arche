import { NextResponse } from 'next/server'

import {
  applyKnowledgeReviewChange,
  regenerateKnowledgeReviewChangeForUser,
  rebaseKnowledgeReviewChangeForUser,
  rejectKnowledgeReviewChangeForUser,
  saveKnowledgeReviewChangeDraft,
} from '@/lib/learning/service'
import { parseProposalActionRequest } from '@/lib/learning/validation'
import { withAuth } from '@/lib/runtime/with-auth'
import type { KnowledgeReviewChange, LearningProposalAction, LearningRun } from '@/types/learning'

type KnowledgeReviewActionResult =
  | { ok: true; change: KnowledgeReviewChange }
  | { ok: true; run: LearningRun }
  | { ok: false; error: string }

async function dispatchKnowledgeReviewAction(args: {
  action: LearningProposalAction
  actor: string
  changeId: string
  content?: string
  slug: string
  userId: string
}): Promise<KnowledgeReviewActionResult> {
  switch (args.action) {
    case 'reject':
      return rejectKnowledgeReviewChangeForUser({ actor: args.actor, userId: args.userId, changeId: args.changeId })
    case 'save_draft':
      return saveKnowledgeReviewChangeDraft({ actor: args.actor, userId: args.userId, changeId: args.changeId, content: args.content ?? '' })
    case 'rebase':
      return rebaseKnowledgeReviewChangeForUser({ actor: args.actor, userId: args.userId, changeId: args.changeId })
    case 'regenerate':
      return regenerateKnowledgeReviewChangeForUser({ actor: args.actor, userId: args.userId, changeId: args.changeId, slug: args.slug })
    case 'apply':
      return applyKnowledgeReviewChange({
        actor: args.actor,
        userId: args.userId,
        slug: args.slug,
        changeId: args.changeId,
        content: args.content,
      })
  }
}

export const POST = withAuth<{ proposal: KnowledgeReviewChange } | { run: LearningRun } | { error: string }>(
  { csrf: true },
  async (request, context) => {
    const body = await request.json().catch(() => null)
    const parsed = parseProposalActionRequest(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }

    const { action, proposalId, content } = parsed.value
    const result = await dispatchKnowledgeReviewAction({
      action,
      actor: context.user.id,
      changeId: proposalId,
      content,
      slug: context.slug,
      userId: context.user.id,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return 'run' in result
      ? NextResponse.json({ run: result.run })
      : NextResponse.json({ proposal: result.change })
  }
)

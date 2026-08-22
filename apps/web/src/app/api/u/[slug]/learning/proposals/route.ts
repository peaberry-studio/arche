import { NextResponse } from 'next/server'

import type { PublishKbResult } from '@/lib/learning/publish-kb'
import {
  applyAndPublishKnowledgeReviewChange,
  regenerateKnowledgeReviewChangeForUser,
  rebaseKnowledgeReviewChangeForUser,
  rejectKnowledgeReviewChangeForUser,
  saveKnowledgeReviewChangeDraft,
} from '@/lib/learning/service'
import { parseProposalActionRequest } from '@/lib/learning/validation'
import { withAuth } from '@/lib/runtime/with-auth'
import { findIdBySlug } from '@/lib/services/user'
import type { KnowledgeReviewChange, LearningProposalAction, LearningRun } from '@/types/learning'

type KnowledgeReviewActionResult =
  | { ok: true; change: KnowledgeReviewChange; publish?: PublishKbResult }
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
      return applyAndPublishKnowledgeReviewChange({
        actor: args.actor,
        userId: args.userId,
        slug: args.slug,
        changeId: args.changeId,
        content: args.content,
      })
  }
}

export const POST = withAuth<
  { proposal: KnowledgeReviewChange; publish?: PublishKbResult } | { run: LearningRun } | { error: string }
>(
  { csrf: true },
  async (request, context) => {
    const body = await request.json().catch(() => null)
    const parsed = parseProposalActionRequest(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }

    const { action, proposalId, content } = parsed.value

    // Review records belong to the workspace owner. An ADMIN can act on
    // another user's workspace, so the owner must be resolved from the slug
    // instead of assuming the acting user is the owner.
    const owner = await findIdBySlug(context.slug)
    if (!owner) {
      return NextResponse.json({ error: 'workspace_owner_not_found' }, { status: 400 })
    }

    const result = await dispatchKnowledgeReviewAction({
      action,
      actor: context.user.id,
      changeId: proposalId,
      content,
      slug: context.slug,
      userId: owner.id,
    })

    if (!result.ok) {
      // The change's state moved underneath a regeneration or apply; these are
      // concurrency conflicts rather than malformed requests.
      const status = CONFLICT_ERRORS.has(result.error) ? 409 : 400
      return NextResponse.json({ error: result.error }, { status })
    }

    return 'run' in result
      ? NextResponse.json({ run: result.run })
      : NextResponse.json({
          proposal: result.change,
          ...(result.publish !== undefined ? { publish: result.publish } : {}),
        })
  }
)

const CONFLICT_ERRORS = new Set([
  'needs_rebase',
  'not_rebaseable',
  'regeneration_source_not_rebaseable',
])

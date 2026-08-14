import { NextRequest, NextResponse } from 'next/server'

import { getInternalLearningContext } from '@/app/api/internal/learning/auth'
import {
  captureKnowledgeReviewBase,
  createKnowledgeReviewChange,
  findLearningRunForUser,
} from '@/lib/learning/service'
import { parseProposalRequest } from '@/lib/learning/validation'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = await getInternalLearningContext(request)
  if (!context.ok) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = parseProposalRequest(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const input = parsed.value
  const run = input.runId
    ? await findLearningRunForUser({ userId: context.userId, runId: input.runId })
    : null
  if (input.runId && !run) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  const base = await captureKnowledgeReviewBase({
    kbPath: input.kbPath,
    operation: input.operation,
    slug: context.slug,
  })
  if (!base.ok) {
    const status = base.error === 'workspace_agent_unavailable' ? 409 : 400
    return NextResponse.json({ error: base.error }, { status })
  }

  const result = await createKnowledgeReviewChange(context.userId, {
    runId: input.runId ?? null,
    regeneratedFromId: run?.regenerationChangeId ?? null,
    author: 'knowledge-curator',
    agent: 'knowledge-curator',
    origin: 'learning',
    title: input.title,
    reason: input.reason ?? 'Proposed by the knowledge curator.',
    confidence: input.confidence ?? 0.5,
    evidence: input.evidence ?? {},
    kbPath: input.kbPath,
    operation: input.operation,
    proposedContent: input.proposedContent,
    baseContent: base.data.baseContent,
    baseHash: base.data.baseHash,
    initialStatus: base.data.initialStatus,
  })

  if (!result.ok) {
    const status = result.error === 'regeneration_source_not_rebaseable' ? 409 : 400
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({ proposal: result.change })
}

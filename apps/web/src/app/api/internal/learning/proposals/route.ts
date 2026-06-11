import { NextRequest, NextResponse } from 'next/server'

import { getInternalLearningContext } from '@/app/api/internal/learning/auth'
import { createLearningProposal, learningRunBelongsToUser } from '@/lib/learning/service'
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
  if (input.runId && !(await learningRunBelongsToUser({ userId: context.userId, runId: input.runId }))) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const proposal = await createLearningProposal(context.userId, {
    runId: input.runId ?? null,
    title: input.title,
    type: input.type,
    confidence: input.confidence ?? 0.5,
    evidence: input.evidence ?? {},
    kbPath: input.kbPath,
    operation: input.operation,
    proposedContent: input.proposedContent,
    currentFileHash: input.currentFileHash ?? null,
    internalSessionId: input.internalSessionId ?? null,
    trigger: input.trigger ?? 'agent',
  })

  return NextResponse.json({ proposal })
}

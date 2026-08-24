import {
  KNOWLEDGE_REVIEW_OPERATIONS,
  LEARNING_AGENT_MAX_LENGTH,
  LEARNING_EVIDENCE_QUOTE_MAX_LENGTH,
  LEARNING_EVIDENCE_SOURCE_MAX_LENGTH,
  LEARNING_KB_PATH_MAX_LENGTH,
  LEARNING_PROPOSAL_ACTIONS,
  LEARNING_PROPOSAL_TYPES,
  LEARNING_PROPOSED_CONTENT_MAX_LENGTH,
  LEARNING_TITLE_MAX_LENGTH,
  LEARNING_TRIGGERS,
  type KnowledgeReviewOperation,
  type LearningEvidence,
  type LearningProposalAction,
  type LearningProposalType,
  type LearningTrigger,
} from '@/types/learning'

export type LearningProposalRequest = {
  runId?: string | null
  title: string
  type?: LearningProposalType
  confidence?: number
  evidence?: LearningEvidence
  kbPath: string
  operation: KnowledgeReviewOperation
  proposedContent: string
  reason?: string
  currentFileHash?: string | null
  internalSessionId?: string | null
  trigger?: LearningTrigger
  agent?: string | null
}

export type LearningProposalActionRequest = {
  action: LearningProposalAction
  proposalId: string
  content?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

function isOptionalStringOrNull(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function isProposalType(value: unknown): value is LearningProposalType {
  return typeof value === 'string' && LEARNING_PROPOSAL_TYPES.includes(value as LearningProposalType)
}

function isOperation(value: unknown): value is KnowledgeReviewOperation {
  return typeof value === 'string' && KNOWLEDGE_REVIEW_OPERATIONS.includes(value as KnowledgeReviewOperation)
}

function isTrigger(value: unknown): value is LearningTrigger {
  return typeof value === 'string' && LEARNING_TRIGGERS.includes(value as LearningTrigger)
}

function isProposalAction(value: unknown): value is LearningProposalAction {
  return typeof value === 'string' && LEARNING_PROPOSAL_ACTIONS.includes(value as LearningProposalAction)
}

// Mirrors the workspace agent's resolvePath rules so invalid paths fail at
// proposal creation instead of surfacing as an agent error on Apply.
export function isValidKbPath(value: unknown): value is string {
  if (!isBoundedString(value, LEARNING_KB_PATH_MAX_LENGTH)) return false
  if (value.includes('\0') || value.includes('\\')) return false

  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment.startsWith('.'))) return false

  return true
}

function parseEvidence(value: unknown): LearningEvidence | null | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null

  const evidence: LearningEvidence = {}
  if (value.sessionId !== undefined) {
    if (typeof value.sessionId !== 'string') return null
    evidence.sessionId = value.sessionId
  }
  if (value.messageId !== undefined) {
    if (typeof value.messageId !== 'string') return null
    evidence.messageId = value.messageId
  }
  if (value.quote !== undefined) {
    if (typeof value.quote !== 'string' || value.quote.length > LEARNING_EVIDENCE_QUOTE_MAX_LENGTH) return null
    evidence.quote = value.quote
  }
  if (value.source !== undefined) {
    if (typeof value.source !== 'string' || value.source.length > LEARNING_EVIDENCE_SOURCE_MAX_LENGTH) return null
    evidence.source = value.source
  }

  return evidence
}

export function parseProposalRequest(body: unknown):
  | { ok: true; value: LearningProposalRequest }
  | { ok: false } {
  if (!isRecord(body)) return { ok: false }
  if (!isBoundedString(body.title, LEARNING_TITLE_MAX_LENGTH)) return { ok: false }
  if (!isValidKbPath(body.kbPath)) return { ok: false }
  // A delete operation carries no file content, so its proposed content may be
  // empty; create/update must always propose a full file.
  if (typeof body.proposedContent !== 'string' || body.proposedContent.length > LEARNING_PROPOSED_CONTENT_MAX_LENGTH) {
    return { ok: false }
  }
  if (body.operation !== 'delete' && !isBoundedString(body.proposedContent, LEARNING_PROPOSED_CONTENT_MAX_LENGTH)) {
    return { ok: false }
  }
  if (!isOperation(body.operation)) return { ok: false }
  if (!isOptionalStringOrNull(body.runId)) return { ok: false }
  if (!isOptionalStringOrNull(body.currentFileHash)) return { ok: false }
  if (!isOptionalStringOrNull(body.internalSessionId)) return { ok: false }
  if (body.type !== undefined && !isProposalType(body.type)) return { ok: false }
  if (body.reason !== undefined && !isBoundedString(body.reason, LEARNING_TITLE_MAX_LENGTH)) return { ok: false }
  if (body.trigger !== undefined && !isTrigger(body.trigger)) return { ok: false }
  if (!isOptionalStringOrNull(body.agent)) return { ok: false }
  if (typeof body.agent === 'string' && body.agent.length > LEARNING_AGENT_MAX_LENGTH) return { ok: false }
  if (body.confidence !== undefined && (
    typeof body.confidence !== 'number' ||
    !Number.isFinite(body.confidence) ||
    body.confidence < 0 ||
    body.confidence > 1
  )) {
    return { ok: false }
  }

  const evidence = parseEvidence(body.evidence)
  if (evidence === null) return { ok: false }

  return {
    ok: true,
    value: {
      runId: body.runId ?? null,
      title: body.title,
      type: body.type,
      confidence: body.confidence,
      evidence,
      kbPath: body.kbPath,
      operation: body.operation,
      proposedContent: body.proposedContent,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      currentFileHash: body.currentFileHash ?? null,
      internalSessionId: body.internalSessionId ?? null,
      trigger: body.trigger,
      agent: body.agent ?? null,
    },
  }
}

export function parseProposalActionRequest(body: unknown):
  | { ok: true; value: LearningProposalActionRequest }
  | { ok: false } {
  if (!isRecord(body)) return { ok: false }
  if (typeof body.proposalId !== 'string' || body.proposalId.trim().length === 0) return { ok: false }
  if (!isProposalAction(body.action)) return { ok: false }
  if (body.action === 'save_draft' && (typeof body.content !== 'string' || body.content.length > LEARNING_PROPOSED_CONTENT_MAX_LENGTH)) {
    return { ok: false }
  }
  if (body.action !== 'save_draft' && body.content !== undefined) {
    // Applying a delete change carries no content. Other actions either ignore
    // content or need a bounded non-empty payload.
    const isEmptyApply = body.action === 'apply' && body.content === ''
    if (!isEmptyApply && !isBoundedString(body.content, LEARNING_PROPOSED_CONTENT_MAX_LENGTH)) {
      return { ok: false }
    }
  }

  return {
    ok: true,
    value: {
      action: body.action,
      proposalId: body.proposalId,
      content: typeof body.content === 'string' ? body.content : undefined,
    },
  }
}

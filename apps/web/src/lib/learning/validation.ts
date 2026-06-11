import {
  LEARNING_EVIDENCE_QUOTE_MAX_LENGTH,
  LEARNING_EVIDENCE_SOURCE_MAX_LENGTH,
  LEARNING_KB_PATH_MAX_LENGTH,
  LEARNING_OPERATIONS,
  LEARNING_PROPOSAL_TYPES,
  LEARNING_PROPOSED_CONTENT_MAX_LENGTH,
  LEARNING_TITLE_MAX_LENGTH,
  LEARNING_TRIGGERS,
  type LearningEvidence,
  type LearningProposalOperation,
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
  operation: LearningProposalOperation
  proposedContent: string
  currentFileHash?: string | null
  internalSessionId?: string | null
  trigger?: LearningTrigger
}

export type LearningProposalActionRequest = {
  action: 'apply' | 'reject'
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

function isOperation(value: unknown): value is LearningProposalOperation {
  return typeof value === 'string' && LEARNING_OPERATIONS.includes(value as LearningProposalOperation)
}

function isTrigger(value: unknown): value is LearningTrigger {
  return typeof value === 'string' && LEARNING_TRIGGERS.includes(value as LearningTrigger)
}

// Mirrors the workspace agent's resolvePath rules so invalid paths fail at
// proposal creation instead of surfacing as an agent error on Apply.
export function isValidKbPath(value: unknown): value is string {
  if (!isBoundedString(value, LEARNING_KB_PATH_MAX_LENGTH)) return false
  if (value.includes('\0') || value.includes('\\')) return false

  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false
  if (segments[0] === '.git') return false

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
  if (!isBoundedString(body.proposedContent, LEARNING_PROPOSED_CONTENT_MAX_LENGTH)) return { ok: false }
  if (!isOperation(body.operation)) return { ok: false }
  if (!isOptionalStringOrNull(body.runId)) return { ok: false }
  if (!isOptionalStringOrNull(body.currentFileHash)) return { ok: false }
  if (!isOptionalStringOrNull(body.internalSessionId)) return { ok: false }
  if (body.type !== undefined && !isProposalType(body.type)) return { ok: false }
  if (body.trigger !== undefined && !isTrigger(body.trigger)) return { ok: false }
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
      currentFileHash: body.currentFileHash ?? null,
      internalSessionId: body.internalSessionId ?? null,
      trigger: body.trigger,
    },
  }
}

export function parseProposalActionRequest(body: unknown):
  | { ok: true; value: LearningProposalActionRequest }
  | { ok: false } {
  if (!isRecord(body)) return { ok: false }
  if (typeof body.proposalId !== 'string' || body.proposalId.trim().length === 0) return { ok: false }
  if (body.action !== 'apply' && body.action !== 'reject') return { ok: false }
  if (body.content !== undefined && !isBoundedString(body.content, LEARNING_PROPOSED_CONTENT_MAX_LENGTH)) {
    return { ok: false }
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

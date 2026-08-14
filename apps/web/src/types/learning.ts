export const LEARNING_PROPOSAL_TYPES = ['fact', 'preference', 'process', 'correction', 'other'] as const
export const LEARNING_TRIGGERS = ['manual', 'auto', 'flow', 'agent'] as const
export const KNOWLEDGE_REVIEW_OPERATIONS = ['create', 'update', 'delete'] as const
export const KNOWLEDGE_REVIEW_STATUSES = ['open', 'needs_rebase', 'applying', 'applied', 'published', 'rejected', 'superseded'] as const
export const LEARNING_PROPOSAL_ACTIONS = ['apply', 'reject', 'save_draft', 'rebase', 'regenerate'] as const

export const LEARNING_TITLE_MAX_LENGTH = 200
export const LEARNING_KB_PATH_MAX_LENGTH = 500
export const LEARNING_PROPOSED_CONTENT_MAX_LENGTH = 200_000
export const LEARNING_EVIDENCE_QUOTE_MAX_LENGTH = 4_000
export const LEARNING_EVIDENCE_SOURCE_MAX_LENGTH = 500

export type LearningTrigger = (typeof LEARNING_TRIGGERS)[number]
export type LearningRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type LearningProposalType = (typeof LEARNING_PROPOSAL_TYPES)[number]
export type KnowledgeReviewOperation = (typeof KNOWLEDGE_REVIEW_OPERATIONS)[number]
export type KnowledgeReviewChangeStatus = (typeof KNOWLEDGE_REVIEW_STATUSES)[number]
export type LearningProposalAction = (typeof LEARNING_PROPOSAL_ACTIONS)[number]

export type LearningEvidence = {
  sessionId?: string
  messageId?: string
  quote?: string
  source?: string
}

export type LearningRun = {
  id: string
  sourceSessionId: string | null
  internalSessionId: string | null
  regenerationChangeId: string | null
  title: string
  trigger: LearningTrigger
  status: LearningRunStatus
  error: string | null
  messageCount: number
  createdAt: string
  updatedAt: string
}

export type KnowledgeReviewAuditEntry = {
  action: string
  actor: string
  at: string
  hash?: string
}

export type KnowledgeReviewChange = {
  id: string
  sourceProposalId: string | null
  regeneratedFromId: string | null
  runId: string | null
  author: string
  agent: string | null
  origin: string
  title: string
  reason: string
  evidence: LearningEvidence
  confidence: number
  kbPath: string
  operation: KnowledgeReviewOperation
  baseContent: string | null
  baseHash: string | null
  proposedContent: string
  status: KnowledgeReviewChangeStatus
  actualContent: string | null
  actualHash: string | null
  appliedHash: string | null
  publishCommitSha: string | null
  auditTrail: KnowledgeReviewAuditEntry[]
  createdAt: string
  updatedAt: string
}

export type KnowledgeReviewRegenerationContext = {
  actualContent: string | null
  baseContent: string | null
  changeId: string
  kbPath: string
  operation: KnowledgeReviewOperation
  proposedContent: string
}

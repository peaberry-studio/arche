export const LEARNING_PROPOSAL_TYPES = ['fact', 'preference', 'process', 'correction', 'other'] as const
export const LEARNING_OPERATIONS = ['create', 'update'] as const
export const LEARNING_TRIGGERS = ['manual', 'auto', 'flow', 'agent'] as const

export const LEARNING_TITLE_MAX_LENGTH = 200
export const LEARNING_KB_PATH_MAX_LENGTH = 500
export const LEARNING_PROPOSED_CONTENT_MAX_LENGTH = 200_000
export const LEARNING_EVIDENCE_QUOTE_MAX_LENGTH = 4_000
export const LEARNING_EVIDENCE_SOURCE_MAX_LENGTH = 500

export type LearningTrigger = (typeof LEARNING_TRIGGERS)[number]
export type LearningRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type LearningProposalStatus = 'pending' | 'rejected' | 'applied'
export type LearningProposalType = (typeof LEARNING_PROPOSAL_TYPES)[number]
export type LearningProposalOperation = (typeof LEARNING_OPERATIONS)[number]

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
  title: string
  trigger: LearningTrigger
  status: LearningRunStatus
  error: string | null
  messageCount: number
  createdAt: string
  updatedAt: string
}

export type LearningProposal = {
  id: string
  runId: string | null
  status: LearningProposalStatus
  title: string
  type: LearningProposalType
  confidence: number
  evidence: LearningEvidence
  kbPath: string
  operation: LearningProposalOperation
  proposedContent: string
  currentFileHash: string | null
  internalSessionId: string | null
  trigger: LearningTrigger
  createdAt: string
  updatedAt: string
}

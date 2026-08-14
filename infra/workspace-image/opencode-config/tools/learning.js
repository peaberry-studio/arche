import { z } from 'zod'

import { toToolOutput } from '../shared/attachment-tools.js'
import { callInternalApi } from '../shared/internal-api.js'

const proposalTypes = ['fact', 'preference', 'process', 'correction', 'other']
const operations = ['create', 'update', 'delete']
const triggers = ['manual', 'auto', 'flow', 'agent']

const argsSchema = z.object({
  runId: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  type: z.enum(proposalTypes).optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.object({
    sessionId: z.string().optional(),
    messageId: z.string().optional(),
    quote: z.string().max(4000).optional(),
    source: z.string().max(500).optional(),
  }).optional(),
  kbPath: z.string().min(1).max(500),
  operation: z.enum(operations),
  // A delete removes the target file, so its proposed content may be empty.
  proposedContent: z.string().max(200000).optional(),
  currentFileHash: z.string().nullable().optional(),
  internalSessionId: z.string().nullable().optional(),
  trigger: z.enum(triggers).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.operation !== 'delete' && !value.proposedContent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'proposedContent is required for create and update operations',
    })
  }
})

export const propose = {
  description: 'Create a pending Knowledge Base learning proposal in Arche. This never writes to KB files; a user must apply the proposal later.',
  args: {
    runId: z.string().nullable().optional().describe('Learning run id, when known.'),
    title: z.string().min(1).max(200).describe('Short proposal title.'),
    type: z.enum(proposalTypes).optional().describe('Learning type.'),
    confidence: z.number().min(0).max(1).optional().describe('Confidence score from 0 to 1.'),
    evidence: z.object({
      sessionId: z.string().optional(),
      messageId: z.string().optional(),
      quote: z.string().max(4000).optional(),
      source: z.string().max(500).optional(),
    }).optional().describe('Evidence supporting this proposal.'),
    kbPath: z.string().min(1).max(500).describe('Target KB path.'),
    operation: z.enum(operations).describe('Whether to create, update, or delete the target KB file.'),
    proposedContent: z.string().max(200000).optional().describe('Full proposed file content; omit or leave empty when deleting the target file.'),
    currentFileHash: z.string().nullable().optional().describe('Current file hash for update conflict detection.'),
    internalSessionId: z.string().nullable().optional().describe('Internal learning session id, when known.'),
    trigger: z.enum(triggers).optional().describe('Learning trigger source.'),
  },
  async execute(args) {
    const parsed = argsSchema.safeParse(args)
    if (!parsed.success) return toToolOutput({ ok: false, error: 'schema_validation_failed' })

    const result = await callInternalApi('/api/internal/learning/proposals', parsed.data)
    if (!result.ok) return toToolOutput({ ok: false, error: result.error })

    return toToolOutput({ ok: true, ...result.data })
  },
}

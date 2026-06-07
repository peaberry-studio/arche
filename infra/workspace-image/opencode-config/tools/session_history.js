import { z } from 'zod'

import { toToolOutput } from '../shared/attachment-tools.js'
import { callInternalApi } from '../shared/internal-api.js'

const argsSchema = z.object({
  includeMessages: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  maxMessagesPerSession: z.number().int().min(1).max(100).optional(),
  query: z.string().max(500).optional(),
  sessionIds: z.array(z.string().min(1)).max(100).optional(),
}).strict()

export const query = {
  description: 'Query prior workspace session history through Arche. Use this to gather evidence before proposing KB updates.',
  args: {
    includeMessages: z.boolean().optional().describe('Include message text for returned sessions.'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum sessions to return.'),
    maxMessagesPerSession: z.number().int().min(1).max(100).optional().describe('Maximum messages per session when includeMessages is true.'),
    query: z.string().max(500).optional().describe('Optional session title search.'),
    sessionIds: z.array(z.string().min(1)).max(100).optional().describe('Specific OpenCode session ids to inspect.'),
  },
  async execute(args) {
    const parsed = argsSchema.safeParse(args)
    if (!parsed.success) return toToolOutput({ ok: false, error: 'schema_validation_failed' })

    const result = await callInternalApi('/api/internal/learning/session-history', parsed.data)
    if (!result.ok) return toToolOutput({ ok: false, error: result.error })

    return toToolOutput({ ok: true, ...result.data })
  },
}

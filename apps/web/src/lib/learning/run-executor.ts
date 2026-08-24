import { KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS } from '@/lib/learning/curator-prompt'
import {
  claimLearningRunForExecution,
  findLearningRunForUser,
  markLearningRunFailed,
  markLearningRunSucceeded,
  setLearningRunInternalSessionId,
} from '@/lib/learning/repository'
import { createInstanceClient } from '@/lib/opencode/client'
import {
  captureSessionMessageCursor,
  createSessionPromptRun,
  EXECUTION_TERMINATION_UNCONFIRMED_ERROR,
  ensureWorkspaceRunningForExecution,
  waitForSessionToComplete,
} from '@/lib/opencode/session-execution'
import { messageRunService } from '@/lib/services'
import { SYSTEM_KNOWLEDGE_CURATOR_AGENT_ID } from '@/lib/workspace-config'
import type { KnowledgeReviewRegenerationContext, LearningTrigger } from '@/types/learning'

const LEARNING_SESSION_TITLE_MAX_LENGTH = 160
const LEARNING_RUN_CANCELLED_ERROR = 'learning_run_cancelled'

export type LearningRunExecutionInput = {
  runId: string
  slug: string
  userId: string
  sourceSessionId: string | null
  title: string
  trigger: LearningTrigger
  regeneration?: KnowledgeReviewRegenerationContext
}

export type LearningRunExecutionResult =
  | { ok: true }
  | { ok: false; error: string; cause?: string }

function buildLearningSessionTitle(title: string): string {
  const base = `Learning | ${title.trim() || 'Session'}`
  return base.length > LEARNING_SESSION_TITLE_MAX_LENGTH
    ? `${base.slice(0, LEARNING_SESSION_TITLE_MAX_LENGTH - 1)}…`
    : base
}

export function buildCuratorPrompt(input: LearningRunExecutionInput): string {
  const sourceInstruction = input.sourceSessionId
    ? `Use the \`session_history_query\` tool to read the source session (sessionIds: ["${input.sourceSessionId}"], includeMessages: true).`
    : 'Use the `session_history_query` tool to review the most recent sessions (includeMessages: true).'

  const regenerationInstructions = input.regeneration ? [
    '',
    'This run regenerates a conflicted Knowledge Review change. Create exactly one replacement proposal for the same path; the server links it to the original and supersedes the original only after that replacement is persisted.',
    `Knowledge Review change id: ${input.regeneration.changeId}`,
    `Target path: ${input.regeneration.kbPath}`,
    `Operation: ${input.regeneration.operation}`,
    '',
    'Canonical three-way conflict context:',
    '--- Base content ---',
    input.regeneration.baseContent ?? '(file did not exist)',
    '--- Current content ---',
    input.regeneration.actualContent ?? '(file no longer exists)',
    '--- Previous proposal ---',
    input.regeneration.proposedContent || '(delete file)',
    '',
    'Regenerate the proposed content against the current content. Call `learning_propose` with this run id and the target path exactly once.',
  ] : []

  return [
    KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS,
    '',
    `Learning run id: ${input.runId}`,
    `Source session: ${input.sourceSessionId ?? 'none (review recent sessions)'}`,
    '',
    'Instructions:',
    `1. ${sourceInstruction}`,
    '2. Inspect the existing Knowledge Base files in the workspace (read, glob, grep) so proposals reuse the existing structure and naming, and so you can decide between updating an existing file or creating a new one.',
    '3. For each durable fact, preference, process, or correction worth keeping, call `learning_propose` with:',
    `   - runId: "${input.runId}"`,
    `   - trigger: "${input.trigger}"`,
    '   - operation "update" (full updated file content) or "create" (full new file content)',
    '   - kbPath relative to the workspace root',
    '   - a short title, type, confidence, and evidence quoting the session when possible',
    '4. Never write Knowledge Base files directly; proposals are reviewed and applied by the user.',
    '5. Skip transient, task-specific, or sensitive details. If there is nothing durable to learn, create no proposals.',
    ...regenerationInstructions,
    '',
    'Finish with a one-paragraph summary of the proposals you created (or why none were needed).',
  ].join('\n')
}

export async function executeLearningRun(input: LearningRunExecutionInput): Promise<LearningRunExecutionResult> {
  // Another dispatch (e.g. a concurrent retry) already owns this run.
  if (!(await claimLearningRunForExecution(input.runId))) {
    return { ok: false, error: 'run_not_claimable' }
  }

  try {
    await ensureWorkspaceRunningForExecution(input.slug, input.userId)

    const client = await createInstanceClient(input.slug)
    if (!client) {
      throw new Error('instance_unavailable')
    }

    const sessionResult = await client.session.create(
      { title: buildLearningSessionTitle(input.title) },
      { throwOnError: true },
    )
    const sessionId = sessionResult.data?.id
    if (!sessionId) {
      throw new Error('learning_session_create_failed')
    }

    await setLearningRunInternalSessionId({ runId: input.runId, internalSessionId: sessionId })

    const getCancellationFailure = async (): Promise<string | null> => {
      const run = await findLearningRunForUser({ runId: input.runId, userId: input.userId })
      if (run?.status !== 'cancelled') return null

      return LEARNING_RUN_CANCELLED_ERROR
    }

    const promptRun = await createSessionPromptRun({
      client,
      sessionId,
      slug: input.slug,
      source: 'learning',
    })
    if (!promptRun.ok) {
      throw new Error('session_busy')
    }

    let completion: Awaited<ReturnType<typeof waitForSessionToComplete>>
    try {
      const cursor = await captureSessionMessageCursor(client, sessionId)
      await client.session.promptAsync(
        {
          agent: SYSTEM_KNOWLEDGE_CURATOR_AGENT_ID,
          parts: [{ text: buildCuratorPrompt(input), type: 'text' }],
          sessionID: sessionId,
        },
        { throwOnError: true },
      )

      completion = await waitForSessionToComplete({
        client,
        cursor,
        onPulse: getCancellationFailure,
        sessionId,
        slug: input.slug,
        usage: { messageRunId: promptRun.run.id, source: 'learning', userId: input.userId },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'learning_prompt_failed'
      await messageRunService.markRunFailed(promptRun.run.id, message).catch(() => undefined)
      throw error
    }

    if (completion.status === 'termination_unconfirmed') {
      console.warn('[learning/run-executor] Runtime termination unconfirmed', {
        cause: completion.cause,
        runId: input.runId,
      })
      return {
        ok: false,
        error: EXECUTION_TERMINATION_UNCONFIRMED_ERROR,
        cause: completion.cause,
      }
    }

    if (completion.status === 'failed') {
      if (completion.error === LEARNING_RUN_CANCELLED_ERROR) {
        await messageRunService.markRunAborted(promptRun.run.id).catch(() => undefined)
        return { ok: false, error: completion.error }
      }

      await messageRunService.markRunFailed(promptRun.run.id, completion.error).catch(() => undefined)
      await markLearningRunFailed({ runId: input.runId, error: completion.error })
      return { ok: false, error: completion.error }
    }

    await messageRunService.markRunSucceeded(promptRun.run.id).catch(() => undefined)
    await markLearningRunSucceeded(input.runId)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'learning_run_failed'
    if (message !== LEARNING_RUN_CANCELLED_ERROR) {
      await markLearningRunFailed({ runId: input.runId, error: message }).catch(() => undefined)
    }
    return { ok: false, error: message }
  }
}

export function dispatchLearningRunExecution(input: LearningRunExecutionInput): void {
  void executeLearningRun(input).catch((error) => {
    console.error('[learning/run-executor] Unexpected learning run failure', {
      runId: input.runId,
      error,
    })
  })
}

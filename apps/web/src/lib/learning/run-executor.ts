import {
  captureSessionMessageCursor,
  createSessionPromptRun,
  EXECUTION_TERMINATION_UNCONFIRMED_ERROR,
  ensureWorkspaceRunningForExecution,
  waitForSessionToComplete,
} from '@/lib/harness/execution'
import { getRuntimeForSlug } from '@/lib/harness/registry'
import { KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS } from '@/lib/learning/curator-prompt'
import {
  claimLearningRunForExecution,
  findLearningRunForUser,
  markLearningRunFailed,
  markLearningRunSucceeded,
  setLearningRunInternalSessionId,
} from '@/lib/learning/repository'
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

export function buildCuratorPrompt(input: LearningRunExecutionInput, callerSessionId?: string): string {
  const sourceInstruction = input.sourceSessionId
    ? `Use the \`arche_tools_session_history_query\` tool to read the source session (sessionIds: ["${input.sourceSessionId}"], includeMessages: true).`
    : 'Use the `arche_tools_session_history_query` tool to review the most recent sessions (includeMessages: true).'

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
    'Regenerate the proposed content against the current content. Call `arche_tools_learning_propose` with this run id and the target path exactly once.',
  ] : []

  return [
    KNOWLEDGE_CURATOR_SYSTEM_INSTRUCTIONS,
    '',
    `Learning run id: ${input.runId}`,
    `Source session: ${input.sourceSessionId ?? 'none (review recent sessions)'}`,
    `For identity-aware tools, set caller_agent to ${JSON.stringify(SYSTEM_KNOWLEDGE_CURATOR_AGENT_ID)}.`,
    ...(callerSessionId ? [`Set caller_session_id to ${JSON.stringify(callerSessionId)} (your current session, not the source session).`] : []),
    '',
    'Instructions:',
    `1. ${sourceInstruction}`,
    '2. Inspect the existing Knowledge Base files in the workspace (read, glob, grep) so proposals reuse the existing structure and naming, and so you can decide between updating an existing file or creating a new one.',
    '3. For each durable fact, preference, process, or correction worth keeping, call `arche_tools_learning_propose` with:',
    `   - runId: "${input.runId}"`,
    `   - trigger: "${input.trigger}"`,
    '   - operation "update" (full updated file content) or "create" (full new file content)',
    '   - kbPath relative to the workspace root',
    '   - a short title, type, confidence, and evidence quoting the session when possible',
    '4. If a proposal returns `pending_proposal_exists`, that path already has a pending proposal: re-read the current file, write content that keeps the changes of `pending.proposedContent` and adds yours, and call again with `supersedesId: pending.id` and `supersedesRevision: pending.revision`. If it changed meanwhile, merge the new pending content and retry. Never drop a pending proposal\'s changes.',
    '5. Never write Knowledge Base files directly; proposals are reviewed and applied by the user.',
    '6. Skip transient, task-specific, or sensitive details. If there is nothing durable to learn, create no proposals.',
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

    const runtimeResult = await getRuntimeForSlug(input.slug)
    if (!runtimeResult.ok) throw new Error(runtimeResult.error.code)
    const client = runtimeResult.data

    const sessionResult = await client.createSession({ title: buildLearningSessionTitle(input.title) })
    if (!sessionResult.ok) throw new Error(sessionResult.error.code)
    const sessionId = sessionResult.data.id

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
      const submitted = await client.prompt({
        agent: SYSTEM_KNOWLEDGE_CURATOR_AGENT_ID,
        parts: [{ text: buildCuratorPrompt(input, sessionId), type: 'text' }],
        sessionId,
      })
      if (!submitted.ok) throw new Error(submitted.error.code)

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

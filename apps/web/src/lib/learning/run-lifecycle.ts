import {
  createLearningRunRecord,
  hasActiveLearningRun,
  hasRecentLearningRun,
  markLearningRunFailed as markLearningRunFailedRecord,
  markLearningRunRunning as markLearningRunRunningRecord,
  markLearningRunSucceeded as markLearningRunSucceededRecord,
  setLearningRunMessageCount,
} from '@/lib/learning/repository'
import type { LearningRun, LearningTrigger } from '@/types/learning'

export const AUTO_LEARNING_MIN_MESSAGES = 12
const AUTO_LEARNING_COOLDOWN_MS = 24 * 60 * 60 * 1000
const STALE_PENDING_RUN_MS = 6 * 60 * 60 * 1000

/*
 * Learning run lifecycle owner.
 *
 * Runs are created as `pending`; callers dispatch them to the curator executor
 * (`@/lib/learning/run-executor`), which claims the run (pending/failed ->
 * running), creates the internal OpenCode session, and finishes it as
 * succeeded/failed. Pending runs older than STALE_PENDING_RUN_MS no longer
 * count as active, so a stuck run cannot block auto-learning indefinitely and
 * can be retried from the curator panel.
 */

export async function createLearningRun(args: {
  userId: string
  slug: string
  sourceSessionId?: string | null
  title?: string
  trigger: LearningTrigger
}): Promise<{ ok: true; run: LearningRun } | { ok: false; error: string }> {
  const run = await createLearningRunRecord({
    userId: args.userId,
    sourceSessionId: args.sourceSessionId ?? null,
    internalSessionId: null,
    title: args.title ?? 'Session',
    trigger: args.trigger,
  })

  return { ok: true, run }
}

export async function markLearningRunRunning(runId: string): Promise<void> {
  await markLearningRunRunningRecord(runId)
}

export async function markLearningRunSucceeded(runId: string): Promise<void> {
  await markLearningRunSucceededRecord(runId)
}

export async function markLearningRunFailed(args: { runId: string; error: string }): Promise<void> {
  await markLearningRunFailedRecord(args)
}

export async function maybeQueueAutoLearningRun(args: {
  userId: string
  slug: string
  sessionId: string
  sessionTitle: string
  messageCount: number
}): Promise<LearningRun | null> {
  if (args.messageCount < AUTO_LEARNING_MIN_MESSAGES) return null

  if (!(await canQueueAutoLearningRun({ userId: args.userId, sessionId: args.sessionId }))) return null

  const run = await createLearningRun({
    userId: args.userId,
    slug: args.slug,
    sourceSessionId: args.sessionId,
    title: args.sessionTitle,
    trigger: 'auto',
  })
  if (!run.ok) return null

  await setLearningRunMessageCount({ runId: run.run.id, messageCount: args.messageCount })
  return run.run
}

export async function canQueueAutoLearningRun(args: { userId: string; sessionId: string }): Promise<boolean> {
  const pendingSince = new Date(Date.now() - STALE_PENDING_RUN_MS)
  if (await hasActiveLearningRun({ userId: args.userId, sessionId: args.sessionId, pendingSince })) return false

  const cooldown = new Date(Date.now() - AUTO_LEARNING_COOLDOWN_MS)
  if (await hasRecentLearningRun({ userId: args.userId, sessionId: args.sessionId, since: cooldown })) return false

  return true
}

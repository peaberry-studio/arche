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
 * `pending` currently means the learning run is queued but curator-agent execution is
 * not wired yet. The internal OpenCode session is created by the execution path (not
 * here), so queued runs do not accumulate orphaned sessions. Pending runs older than
 * STALE_PENDING_RUN_MS no longer count as active, so a stuck run cannot block
 * auto-learning indefinitely. Keep run status mutations in this module so the future
 * execution path has one place to own pending -> running -> succeeded/failed
 * transitions.
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
}): Promise<void> {
  if (args.messageCount < AUTO_LEARNING_MIN_MESSAGES) return

  if (!(await canQueueAutoLearningRun({ userId: args.userId, sessionId: args.sessionId }))) return

  const run = await createLearningRun({
    userId: args.userId,
    slug: args.slug,
    sourceSessionId: args.sessionId,
    title: args.sessionTitle,
    trigger: 'auto',
  })
  if (run.ok) {
    await setLearningRunMessageCount({ runId: run.run.id, messageCount: args.messageCount })
  }
}

export async function canQueueAutoLearningRun(args: { userId: string; sessionId: string }): Promise<boolean> {
  const pendingSince = new Date(Date.now() - STALE_PENDING_RUN_MS)
  if (await hasActiveLearningRun({ userId: args.userId, sessionId: args.sessionId, pendingSince })) return false

  const cooldown = new Date(Date.now() - AUTO_LEARNING_COOLDOWN_MS)
  if (await hasRecentLearningRun({ userId: args.userId, sessionId: args.sessionId, since: cooldown })) return false

  return true
}

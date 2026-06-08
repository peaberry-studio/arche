import { getLearningSessionTitle } from '@/lib/learning/session-title'
import {
  createLearningRunRecord,
  hasActiveLearningRun,
  hasRecentLearningRun,
  markLearningRunFailed as markLearningRunFailedRecord,
  markLearningRunRunning as markLearningRunRunningRecord,
  markLearningRunSucceeded as markLearningRunSucceededRecord,
  setLearningRunMessageCount,
} from '@/lib/learning/repository'
import { createInstanceClient } from '@/lib/opencode/client'
import type { LearningRun, LearningTrigger } from '@/types/learning'

const AUTO_LEARNING_MIN_MESSAGES = 12
const AUTO_LEARNING_COOLDOWN_MS = 24 * 60 * 60 * 1000

/*
 * Learning run lifecycle owner.
 *
 * `pending` currently means the learning run has been created and associated with an
 * internal OpenCode session, but curator-agent execution is not wired yet. Keep run
 * status mutations in this module so the future execution path has one place to own
 * pending -> running -> succeeded/failed transitions.
 */

export async function createLearningRun(args: {
  userId: string
  slug: string
  sourceSessionId?: string | null
  title?: string
  trigger: LearningTrigger
}): Promise<{ ok: true; run: LearningRun } | { ok: false; error: string }> {
  const client = await createInstanceClient(args.slug)
  if (!client) {
    return { ok: false, error: 'instance_unavailable' }
  }

  const sourceTitle = args.title ?? 'Session'
  const createdSession = await client.session.create({ title: getLearningSessionTitle(sourceTitle) })
  const run = await createLearningRunRecord({
    userId: args.userId,
    sourceSessionId: args.sourceSessionId ?? null,
    internalSessionId: createdSession.data?.id ?? null,
    title: sourceTitle,
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
  if (await hasActiveLearningRun({ userId: args.userId, sessionId: args.sessionId })) return false

  const cooldown = new Date(Date.now() - AUTO_LEARNING_COOLDOWN_MS)
  if (await hasRecentLearningRun({ userId: args.userId, sessionId: args.sessionId, since: cooldown })) return false

  return true
}

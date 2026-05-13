import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'

export type MessageRunStatus = 'running' | 'succeeded' | 'failed' | 'aborted'
export type ActiveRunRuntimeState = 'busy' | 'idle' | 'unknown'

export const MESSAGE_RUN_TIMEOUT_MS = 35 * 60 * 1000

export type MessageRunRecord = {
  id: string
  slug: string
  sessionId: string
  source: string
  status: MessageRunStatus
  error: string | null
  startedAt: Date
  finishedAt: Date | null
}

type CreateActiveRunResult =
  | { ok: true; run: MessageRunRecord }
  | { ok: false; error: 'session_busy'; activeRun: MessageRunRecord | null }

type CreateActiveRunAfterRuntimeStateCheckParams = {
  readRuntimeSessionState: () => Promise<ActiveRunRuntimeState>
  sessionId: string
  slug: string
  source: string
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  )
}

function toRunRecord(run: {
  id: string
  slug: string
  sessionId: string
  source: string
  status: string
  error: string | null
  startedAt: Date
  finishedAt: Date | null
}): MessageRunRecord {
  return {
    id: run.id,
    slug: run.slug,
    sessionId: run.sessionId,
    source: run.source,
    status: isMessageRunStatus(run.status) ? run.status : 'failed',
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  }
}

function isMessageRunStatus(status: string): status is MessageRunStatus {
  return (
    status === 'running' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'aborted'
  )
}

export async function findRunById(runId: string): Promise<MessageRunRecord | null> {
  const run = await prisma.messageRun.findUnique({ where: { id: runId } })
  return run ? toRunRecord(run) : null
}

export async function findActiveRun(
  slug: string,
  sessionId: string,
): Promise<MessageRunRecord | null> {
  const lock = await prisma.messageRunLock.findUnique({
    where: { slug_sessionId: { slug, sessionId } },
    include: { run: true },
  })
  return lock?.run ? toRunRecord(lock.run) : null
}

export async function createActiveRun(params: {
  slug: string
  sessionId: string
  source: string
}): Promise<CreateActiveRunResult> {
  const runId = randomUUID()

  try {
    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.messageRun.create({
        data: {
          id: runId,
          slug: params.slug,
          sessionId: params.sessionId,
          source: params.source,
          status: 'running',
        },
      })

      await tx.messageRunLock.create({
        data: {
          slug: params.slug,
          sessionId: params.sessionId,
          runId,
        },
      })

      return created
    })

    return { ok: true, run: toRunRecord(run) }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        ok: false,
        error: 'session_busy',
        activeRun: await findActiveRun(params.slug, params.sessionId),
      }
    }

    throw error
  }
}

export async function createActiveRunAfterRuntimeStateCheck(
  params: CreateActiveRunAfterRuntimeStateCheckParams,
): Promise<CreateActiveRunResult> {
  const firstAttempt = await createActiveRun({
    slug: params.slug,
    sessionId: params.sessionId,
    source: params.source,
  })
  if (firstAttempt.ok) return firstAttempt

  const runtimeState = await params.readRuntimeSessionState()
  if (runtimeState !== 'idle') {
    return firstAttempt
  }

  await markActiveRunSucceeded(params.slug, params.sessionId)
  return createActiveRun({
    slug: params.slug,
    sessionId: params.sessionId,
    source: params.source,
  })
}

export async function reapStaleRuns(now = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - MESSAGE_RUN_TIMEOUT_MS)
  const staleLocks = await prisma.messageRunLock.findMany({
    where: {
      run: {
        is: {
          startedAt: { lte: threshold },
          status: 'running',
        },
      },
    },
    select: { runId: true },
  })

  if (staleLocks.length === 0) return 0

  const runIds = staleLocks.map((lock) => lock.runId)
  const [updated] = await prisma.$transaction([
    prisma.messageRun.updateMany({
      where: {
        id: { in: runIds },
        status: 'running',
      },
      data: {
        error: 'message_run_timeout',
        finishedAt: now,
        status: 'failed',
      },
    }),
    prisma.messageRunLock.deleteMany({ where: { runId: { in: runIds } } }),
  ])

  return updated.count
}

export async function markRunSucceeded(runId: string): Promise<void> {
  await finishRun(runId, 'succeeded', null)
}

export async function markRunFailed(runId: string, error: string): Promise<void> {
  await finishRun(runId, 'failed', error)
}

export async function markRunAborted(runId: string): Promise<void> {
  await finishRun(runId, 'aborted', 'cancelled')
}

export async function markActiveRunSucceeded(
  slug: string,
  sessionId: string,
): Promise<void> {
  const activeRun = await findActiveRun(slug, sessionId)
  if (!activeRun) return

  await markRunSucceeded(activeRun.id)
}

export async function abortActiveRun(
  slug: string,
  sessionId: string,
): Promise<void> {
  const activeRun = await findActiveRun(slug, sessionId)
  if (!activeRun) return

  await markRunAborted(activeRun.id)
}

async function finishRun(
  runId: string,
  status: Exclude<MessageRunStatus, 'running'>,
  error: string | null,
): Promise<void> {
  await prisma.$transaction([
    prisma.messageRun.updateMany({
      where: { id: runId, status: 'running' },
      data: {
        status,
        error,
        finishedAt: new Date(),
      },
    }),
    prisma.messageRunLock.deleteMany({ where: { runId } }),
  ])
}

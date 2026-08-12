/**
 * Integration test for reapStaleRuns() against a real Postgres.
 *
 * Reproduces the TOCTOU interleaving from issue #422: the reaper reads stale
 * locks, and while it is paused a session finishes its run and starts a fresh
 * one for the same (slug, sessionId).
 *
 * Requires DATABASE_URL pointing at a Postgres with migrations applied:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/arche_ci pnpm exec vitest run src/lib/services/__tests__/message-run.e2e.test.ts
 */
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const DATABASE_URL = process.env.DATABASE_URL
const SKIP = !DATABASE_URL

type PrismaModule = typeof import('@/lib/prisma')
type MessageRunModule = typeof import('../message-run')
type PrismaClientType = import('@prisma/client').PrismaClient

let prismaModule: PrismaModule
let messageRunModule: MessageRunModule
let baseClient: PrismaClientType
let controlClient: PrismaClientType

describe.runIf(!SKIP)('reapStaleRuns stale-lock read vs reap race', () => {
  beforeAll(async () => {
    // Dynamic imports so the module loads without a DATABASE_URL when skipped.
    prismaModule = await import('@/lib/prisma')
    messageRunModule = await import('../message-run')

    await prismaModule.initWebPrisma()
    baseClient = globalThis.prisma!

    const { PrismaClient } = await import('@prisma/client')
    const { PrismaPg } = await import('@prisma/adapter-pg')
    const { Pool } = await import('pg')
    controlClient = new PrismaClient({
      adapter: new PrismaPg(new Pool({ connectionString: DATABASE_URL })),
    })
  })

  afterAll(async () => {
    globalThis.prisma = baseClient
    await Promise.allSettled([controlClient.$disconnect(), baseClient.$disconnect()])
  })

  it('does not fail a replacement run started for the same session between the stale-lock query and the reap', async () => {
    const now = new Date()
    const slug = `e2e-reap-${randomUUID()}`
    const sessionId = `session-${randomUUID()}`
    const staleRunId = randomUUID()
    const replacementRunId = randomUUID()

    // Seed a stale running run R1 with its lock L1 for (slug, sessionId).
    await controlClient.messageRun.create({
      data: {
        id: staleRunId,
        slug,
        sessionId,
        source: 'test',
        status: 'running',
        startedAt: new Date(now.getTime() - messageRunModule.MESSAGE_RUN_TIMEOUT_MS - 60_000),
      },
    })
    await controlClient.messageRunLock.create({
      data: { slug, sessionId, runId: staleRunId },
    })

    // Pause the reaper immediately after its stale-lock findMany returns.
    let markStaleLocksRead!: () => void
    const staleLocksRead = new Promise<void>((resolve) => {
      markStaleLocksRead = resolve
    })
    let releaseReaper!: () => void
    const reaperGate = new Promise<void>((resolve) => {
      releaseReaper = resolve
    })

    const gatedClient = baseClient.$extends({
      query: {
        messageRunLock: {
          async findMany({ args, query }) {
            const result = await query(args)
            markStaleLocksRead()
            await reaperGate
            return result
          },
        },
      },
    })
    vi.stubGlobal('prisma', gatedClient)

    try {
      const reapPromise = messageRunModule.reapStaleRuns(now)
      await staleLocksRead

      // Interleaving from a second client while the reaper is paused:
      // R1 finishes successfully, its lock is deleted, and a fresh run R2
      // with a fresh lock L2 starts for the same session.
      await controlClient.messageRun.updateMany({
        where: { id: staleRunId, status: 'running' },
        data: { status: 'succeeded', error: null, finishedAt: new Date() },
      })
      await controlClient.messageRunLock.deleteMany({ where: { runId: staleRunId } })
      await controlClient.messageRun.create({
        data: {
          id: replacementRunId,
          slug,
          sessionId,
          source: 'test',
          status: 'running',
          startedAt: new Date(),
        },
      })
      await controlClient.messageRunLock.create({
        data: { slug, sessionId, runId: replacementRunId },
      })

      releaseReaper()
      const reaped = await reapPromise

      expect(reaped).toBe(0)
      const staleRun = await controlClient.messageRun.findUnique({
        where: { id: staleRunId },
      })
      expect(staleRun?.status).toBe('succeeded')
      expect(staleRun?.error).toBeNull()
      const replacementRun = await controlClient.messageRun.findUnique({
        where: { id: replacementRunId },
      })
      expect(replacementRun?.status).toBe('running')
      const lock = await controlClient.messageRunLock.findUnique({
        where: { slug_sessionId: { slug, sessionId } },
      })
      expect(lock?.runId).toBe(replacementRunId)
    } finally {
      vi.unstubAllGlobals()
      await controlClient.messageRunLock.deleteMany({
        where: { runId: { in: [staleRunId, replacementRunId] } },
      })
      await controlClient.messageRun.deleteMany({
        where: { id: { in: [staleRunId, replacementRunId] } },
      })
    }
  })
})

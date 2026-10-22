import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrismaClient, type Prisma } from '@/generated/prisma-desktop'
import * as flowRuns from '@/lib/services/flow-runs'
import * as flowSteps from '@/lib/services/flow-steps'
import * as messageRuns from '@/lib/services/message-run'
import { settleRuntimeMigratedRuns } from '@/lib/services/runtime-migration'

const { transact } = vi.hoisted(() => ({ transact: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction: (...args: unknown[]) => transact(...args),
  get flowRun() { return client.flowRun },
  get flowRunStep() { return client.flowRunStep },
  get messageRun() { return client.messageRun },
  get messageRunLock() { return client.messageRunLock },
} }))

let client: PrismaClient

describe('runtime migration transaction', () => {
  beforeEach(async () => {
    client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: ':memory:' }) })
    transact.mockImplementation((input: ((transaction: unknown) => Promise<unknown>) | Prisma.PrismaPromise<unknown>[]) => (
      typeof input === 'function' ? client.$transaction(input) : client.$transaction(input)
    ))

    const statements = [
      'CREATE TABLE users (id TEXT PRIMARY KEY, slug TEXT UNIQUE)',
      'CREATE TABLE flows (id TEXT PRIMARY KEY, user_id TEXT, lease_owner TEXT, lease_expires_at DATETIME, updated_at DATETIME)',
      `CREATE TABLE flow_runs (id TEXT PRIMARY KEY, flow_id TEXT, execution_user_id TEXT, status TEXT,
        current_node_id TEXT, error TEXT, finished_at DATETIME, last_retry_error TEXT, retry_scheduled_for DATETIME,
        opencode_session_id TEXT, session_title TEXT, attempt INTEGER DEFAULT 1, updated_at DATETIME)`,
      `CREATE TABLE flow_run_steps (id TEXT PRIMARY KEY, run_id TEXT, node_id TEXT, node_name TEXT, node_type TEXT DEFAULT 'agent',
        status TEXT, input JSON, raw_output TEXT, compacted_output TEXT, human_response TEXT, error TEXT,
        started_at DATETIME, finished_at DATETIME, created_at DATETIME DEFAULT '2026-10-20T00:00:00.000Z',
        updated_at DATETIME DEFAULT '2026-10-20T00:00:00.000Z', UNIQUE (run_id, node_id))`,
      "CREATE TABLE message_runs (id TEXT PRIMARY KEY, slug TEXT, opencode_session_id TEXT DEFAULT 'session-1', status TEXT, error TEXT, finished_at DATETIME, updated_at DATETIME)",
      'CREATE TABLE message_run_locks (slug TEXT, opencode_session_id TEXT, run_id TEXT UNIQUE, PRIMARY KEY (slug, opencode_session_id))',
      "INSERT INTO users VALUES ('alice-id', 'alice'), ('bob-id', 'bob')",
      `INSERT INTO flows (id, user_id, lease_owner) VALUES
        ('own', 'alice-id', 'worker-own'), ('shared', 'bob-id', 'worker-shared'),
        ('other', 'alice-id', 'worker-other'), ('waiting', 'alice-id', 'worker-waiting'), ('done', 'alice-id', 'worker-done')`,
      `INSERT INTO flow_runs (id, flow_id, execution_user_id, status, retry_scheduled_for) VALUES
        ('own-run', 'own', NULL, 'running', '2026-10-20T00:00:00Z'),
        ('shared-run', 'shared', 'alice-id', 'running', NULL),
        ('other-run', 'other', 'bob-id', 'running', NULL),
        ('waiting-run', 'waiting', 'alice-id', 'waiting_for_human', NULL),
        ('done-run', 'done', 'alice-id', 'succeeded', NULL)`,
      "UPDATE flow_runs SET opencode_session_id = id || '-session'",
      `INSERT INTO flow_run_steps (id, run_id, status) VALUES
        ('pending', 'own-run', 'pending'), ('running', 'shared-run', 'running'),
        ('waiting', 'waiting-run', 'waiting_for_human'), ('done', 'own-run', 'succeeded'),
        ('other', 'other-run', 'running'), ('done-run-step', 'done-run', 'succeeded')`,
      'UPDATE flow_run_steps SET node_id = id',
      "INSERT INTO message_runs (id, slug, status) VALUES ('alice-message', 'alice', 'running'), ('bob-message', 'bob', 'running'), ('done-message', 'alice', 'succeeded')",
      "INSERT INTO message_run_locks VALUES ('alice', 'session-1', 'alice-message'), ('bob', 'session-1', 'bob-message')",
    ]
    for (const statement of statements) await client.$executeRawUnsafe(statement)
  })

  afterEach(async () => {
    await client.$disconnect()
  })

  it('settles execution-scoped work and leases while preserving other workspaces and terminal history', async () => {
    await settleRuntimeMigratedRuns('alice')

    expect(await client.$queryRawUnsafe('SELECT id, status, error FROM flow_runs ORDER BY id')).toEqual([
      { id: 'done-run', status: 'succeeded', error: null },
      { id: 'other-run', status: 'running', error: null },
      { id: 'own-run', status: 'failed', error: 'runtime_migrated' },
      { id: 'shared-run', status: 'failed', error: 'runtime_migrated' },
      { id: 'waiting-run', status: 'failed', error: 'runtime_migrated' },
    ])
    expect(await client.$queryRawUnsafe('SELECT id, status, error FROM flow_run_steps ORDER BY id')).toEqual([
      { id: 'done', status: 'succeeded', error: null },
      { id: 'done-run-step', status: 'succeeded', error: null },
      { id: 'other', status: 'running', error: null },
      { id: 'pending', status: 'failed', error: 'runtime_migrated' },
      { id: 'running', status: 'failed', error: 'runtime_migrated' },
      { id: 'waiting', status: 'failed', error: 'runtime_migrated' },
    ])
    expect(await client.$queryRawUnsafe('SELECT id, lease_owner FROM flows ORDER BY id')).toEqual([
      { id: 'done', lease_owner: 'worker-done' },
      { id: 'other', lease_owner: 'worker-other' },
      { id: 'own', lease_owner: null },
      { id: 'shared', lease_owner: null },
      { id: 'waiting', lease_owner: null },
    ])
    expect(await client.$queryRawUnsafe('SELECT id, status, error FROM message_runs ORDER BY id')).toEqual([
      { id: 'alice-message', status: 'failed', error: 'runtime_migrated' },
      { id: 'bob-message', status: 'running', error: null },
      { id: 'done-message', status: 'succeeded', error: null },
    ])
    expect(await client.$queryRawUnsafe('SELECT slug, run_id FROM message_run_locks')).toEqual([{ slug: 'bob', run_id: 'bob-message' }])
    const snapshot = await client.$queryRawUnsafe('SELECT * FROM flow_runs ORDER BY id')
    await settleRuntimeMigratedRuns('alice')
    expect(await client.$queryRawUnsafe('SELECT * FROM flow_runs ORDER BY id')).toEqual(snapshot)
  })

  it('rolls back message settlement and lock cleanup when flow step settlement fails', async () => {
    await client.$executeRawUnsafe(`CREATE TRIGGER reject_step_settlement BEFORE UPDATE ON flow_run_steps
      BEGIN SELECT RAISE(ABORT, 'step_settlement_failed'); END`)

    await expect(settleRuntimeMigratedRuns('alice')).rejects.toThrow()

    expect(await client.$queryRawUnsafe("SELECT status, error FROM message_runs WHERE id = 'alice-message'")).toEqual([{ status: 'running', error: null }])
    expect(await client.$queryRawUnsafe("SELECT run_id FROM message_run_locks WHERE slug = 'alice'")).toEqual([{ run_id: 'alice-message' }])
    expect(await client.$queryRawUnsafe("SELECT status, error FROM flow_runs WHERE id = 'own-run'")).toEqual([{ status: 'running', error: null }])
    expect(await client.$queryRawUnsafe("SELECT lease_owner FROM flows WHERE id = 'own'")).toEqual([{ lease_owner: 'worker-own' }])
  })

  it('preserves a sessionless startup run, its steps and lease so it can continue on the new runtime', async () => {
    await client.$executeRawUnsafe("INSERT INTO flows (id, user_id, lease_owner) VALUES ('startup', 'alice-id', 'worker-startup')")
    await client.$executeRawUnsafe("INSERT INTO flow_runs (id, flow_id, execution_user_id, status) VALUES ('startup-run', 'startup', 'alice-id', 'running')")
    await client.$executeRawUnsafe("INSERT INTO flow_run_steps (id, run_id, node_id, status) VALUES ('startup-pending', 'startup-run', 'first', 'pending')")
    const runSnapshot = await client.$queryRawUnsafe("SELECT * FROM flow_runs WHERE id = 'startup-run'")
    const stepSnapshot = await client.$queryRawUnsafe("SELECT * FROM flow_run_steps WHERE run_id = 'startup-run'")
    const leaseSnapshot = await client.$queryRawUnsafe("SELECT * FROM flows WHERE id = 'startup'")

    await settleRuntimeMigratedRuns('alice')

    expect(await client.$queryRawUnsafe("SELECT * FROM flow_runs WHERE id = 'startup-run'")).toEqual(runSnapshot)
    expect(await client.$queryRawUnsafe("SELECT * FROM flow_run_steps WHERE run_id = 'startup-run'")).toEqual(stepSnapshot)
    expect(await client.$queryRawUnsafe("SELECT * FROM flows WHERE id = 'startup'")).toEqual(leaseSnapshot)
    await expect(flowRuns.attachRunSession('startup-run', { openCodeSessionId: 'new-runtime-session', sessionTitle: 'New runtime' }))
      .resolves.toEqual({ count: 1 })
    await expect(flowSteps.upsertRunStep({ runId: 'startup-run', nodeId: 'first', nodeType: 'agent', status: 'running' }))
      .resolves.toMatchObject({ status: 'running' })
  })

  it.each(['running', 'waiting_for_human'])('settles unarchived messages and %s flows whose source sessions were deleted', async (status) => {
    await client.$executeRawUnsafe("UPDATE flow_runs SET status = ?, opencode_session_id = 'deleted-flow-session' WHERE id = 'own-run'", status)
    if (status === 'waiting_for_human') {
      await client.$executeRawUnsafe("UPDATE flow_run_steps SET status = 'waiting_for_human' WHERE id = 'pending'")
    }
    await client.$executeRawUnsafe("UPDATE message_runs SET opencode_session_id = 'deleted-message-session' WHERE id = 'alice-message'")
    await client.$executeRawUnsafe("UPDATE message_run_locks SET opencode_session_id = 'deleted-message-session' WHERE run_id = 'alice-message'")

    await settleRuntimeMigratedRuns('alice')

    expect(await client.$queryRawUnsafe("SELECT status, error, opencode_session_id, retry_scheduled_for FROM flow_runs WHERE id = 'own-run'")).toEqual([
      { status: 'failed', error: 'runtime_migrated', opencode_session_id: 'deleted-flow-session', retry_scheduled_for: null },
    ])
    expect(await client.$queryRawUnsafe("SELECT status, error FROM flow_run_steps WHERE id = 'pending'")).toEqual([{ status: 'failed', error: 'runtime_migrated' }])
    expect(await client.$queryRawUnsafe("SELECT lease_owner FROM flows WHERE id = 'own'")).toEqual([{ lease_owner: null }])
    expect(await client.$queryRawUnsafe("SELECT status, error FROM message_runs WHERE id = 'alice-message'")).toEqual([{ status: 'failed', error: 'runtime_migrated' }])
    expect(await client.$queryRawUnsafe("SELECT run_id FROM message_run_locks WHERE slug = 'alice'")).toEqual([])
  })

  it('fences late run transitions, retries, session attachment and both existing/new step writes after migration', async () => {
    await settleRuntimeMigratedRuns('alice')
    const runSnapshot = await client.$queryRawUnsafe("SELECT * FROM flow_runs WHERE id = 'own-run'")
    const stepSnapshot = await client.$queryRawUnsafe("SELECT * FROM flow_run_steps WHERE run_id = 'own-run' ORDER BY id")

    await expect(flowRuns.attachRunSession('own-run', { openCodeSessionId: 'late-session', sessionTitle: 'Late' })).resolves.toEqual({ count: 0 })
    await expect(flowRuns.updateRunCurrentNode('own-run', 'late-node')).resolves.toEqual({ count: 0 })
    await expect(flowRuns.markRunWaitingForHuman('own-run', 'late-node')).resolves.toEqual({ count: 0 })
    await expect(flowRuns.markRunRunning('own-run')).resolves.toEqual({ count: 0 })
    await expect(flowRuns.markRunSucceeded('own-run', { finishedAt: new Date() })).resolves.toEqual({ count: 0 })
    await expect(flowRuns.markRunFailed('own-run', { error: 'late_failure', finishedAt: new Date() })).resolves.toEqual({ count: 0 })
    await expect(flowRuns.markRunRetryScheduled('own-run', { attempt: 2, error: 'late_failure', retryAt: new Date() })).resolves.toEqual({ count: 0 })
    await expect(flowSteps.updateRunStepByRunIdAndNodeId('own-run', 'pending', { status: 'succeeded', rawOutput: 'Late output' }))
      .rejects.toThrow('runtime_migrated')
    for (const nodeId of ['pending', 'late-node']) {
      await expect(flowSteps.upsertRunStep({ runId: 'own-run', nodeId, nodeType: 'agent', status: 'running' }))
        .rejects.toThrow('runtime_migrated')
    }

    expect(await client.$queryRawUnsafe("SELECT * FROM flow_runs WHERE id = 'own-run'")).toEqual(runSnapshot)
    expect(await client.$queryRawUnsafe("SELECT * FROM flow_run_steps WHERE run_id = 'own-run' ORDER BY id")).toEqual(stepSnapshot)
  })

  it.each([false, true])('preserves migration settlement for a session-bound human flow (resume already started=%s)', async (resuming) => {
    if (resuming) await flowRuns.markRunRunning('waiting-run')

    await settleRuntimeMigratedRuns('alice')
    const runSnapshot = await client.$queryRawUnsafe("SELECT * FROM flow_runs WHERE id = 'waiting-run'")
    const stepSnapshot = await client.$queryRawUnsafe("SELECT * FROM flow_run_steps WHERE run_id = 'waiting-run'")

    await expect(flowRuns.markRunRunning('waiting-run')).resolves.toEqual({ count: 0 })
    await expect(flowSteps.updateRunStepByRunIdAndNodeId('waiting-run', 'waiting', { status: 'succeeded', humanResponse: 'Late approval' }))
      .rejects.toThrow('runtime_migrated')
    expect(await client.$queryRawUnsafe("SELECT * FROM flow_runs WHERE id = 'waiting-run'")).toEqual(runSnapshot)
    expect(await client.$queryRawUnsafe("SELECT * FROM flow_run_steps WHERE run_id = 'waiting-run'")).toEqual(stepSnapshot)
  })

  it('keeps migrated message errors and replacement locks through late success, failure and abort finalizers', async () => {
    await settleRuntimeMigratedRuns('alice')
    const snapshot = await client.$queryRawUnsafe("SELECT * FROM message_runs WHERE id = 'alice-message'")
    await client.$executeRawUnsafe("INSERT INTO message_runs (id, slug, status) VALUES ('replacement', 'alice', 'running')")
    await client.$executeRawUnsafe("INSERT INTO message_run_locks VALUES ('alice', 'session-1', 'replacement')")

    await messageRuns.markRunSucceeded('alice-message')
    await messageRuns.markRunFailed('alice-message', 'late_failure')
    await messageRuns.markRunAborted('alice-message')

    expect(await client.$queryRawUnsafe("SELECT * FROM message_runs WHERE id = 'alice-message'")).toEqual(snapshot)
    expect(await client.$queryRawUnsafe("SELECT run_id FROM message_run_locks WHERE slug = 'alice'")).toEqual([{ run_id: 'replacement' }])
  })

  it('allows active step upserts and human resume but preserves cancellation settlement', async () => {
    await expect(flowSteps.upsertRunStep({ runId: 'own-run', nodeId: 'new-node', nodeType: 'agent', status: 'running' }))
      .resolves.toMatchObject({ nodeId: 'new-node', status: 'running' })
    await expect(flowSteps.updateRunStepByRunIdAndNodeId('waiting-run', 'waiting', { status: 'succeeded', humanResponse: 'Approved' }))
      .resolves.toMatchObject({ status: 'succeeded', humanResponse: 'Approved' })
    await expect(flowRuns.markRunRunning('waiting-run')).resolves.toEqual({ count: 1 })
    await expect(flowRuns.cancelRunById('own-run', new Date())).resolves.toBe(true)

    await expect(flowRuns.markRunRunning('own-run')).resolves.toEqual({ count: 0 })
    await expect(flowRuns.markRunWaitingForHuman('own-run', 'late-node')).resolves.toEqual({ count: 0 })
    await expect(flowSteps.upsertRunStep({ runId: 'own-run', nodeId: 'late-node', nodeType: 'agent', status: 'running' }))
      .rejects.toThrow('flow_run_cancelled')
    await expect(flowSteps.updateRunStepByRunIdAndNodeId('own-run', 'new-node', { status: 'succeeded' }))
      .rejects.toThrow('flow_run_cancelled')
    expect(await client.$queryRawUnsafe("SELECT status, error FROM flow_run_steps WHERE run_id = 'own-run' AND status = 'failed'"))
      .toHaveLength(2)
  })
})

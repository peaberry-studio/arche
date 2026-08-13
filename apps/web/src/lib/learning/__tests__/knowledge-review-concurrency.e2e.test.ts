/**
 * Integration tests for concurrent Knowledge Review transitions against a real Postgres.
 *
 * transitionKnowledgeReviewChange reads the row, appends an audit entry in memory,
 * and writes the whole trail back. The updateMany WHERE guard only rejects a second
 * writer when the transition changes `status`, so two transitions that leave the
 * status untouched (autosaved drafts are `open -> open`) both pass the guard and the
 * last write silently drops the other's audit entry.
 *
 * Requires DATABASE_URL pointing at a Postgres with migrations applied:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/arche_ci pnpm exec vitest run src/lib/learning/__tests__/knowledge-review-concurrency.e2e.test.ts
 */
import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { KnowledgeReviewAuditEntry } from '@/types/learning'

const DATABASE_URL = process.env.DATABASE_URL
const SKIP = !DATABASE_URL

type PrismaModule = typeof import('@/lib/prisma')
type RepositoryModule = typeof import('../repository')
type PrismaClientType = import('@prisma/client').PrismaClient

let prismaModule: PrismaModule
let repository: RepositoryModule
let baseClient: PrismaClientType
let controlClient: PrismaClientType
let userId: string

async function seedChange(overrides: { status?: 'open' | 'needs_rebase' } = {}): Promise<string> {
  const change = await controlClient.knowledgeReviewChange.create({
    data: {
      userId,
      author: 'knowledge-curator',
      agent: 'knowledge-curator',
      origin: 'learning',
      title: 'Remember preference',
      reason: 'Durable user preference.',
      evidence: { quote: 'Use concise answers' },
      confidence: 0.8,
      kbPath: `Preferences/${randomUUID()}.md`,
      operation: 'update',
      baseContent: '# Preference\n',
      baseHash: 'sha256:base',
      proposedContent: '# Preference\n',
      status: overrides.status ?? 'open',
      auditTrail: [{ action: 'created', actor: 'knowledge-curator', at: new Date().toISOString() }],
    },
  })
  return change.id
}

async function readAuditTrail(changeId: string): Promise<KnowledgeReviewAuditEntry[]> {
  const change = await controlClient.knowledgeReviewChange.findUniqueOrThrow({ where: { id: changeId } })
  return change.auditTrail as unknown as KnowledgeReviewAuditEntry[]
}

describe.runIf(!SKIP)('concurrent Knowledge Review transitions', () => {
  beforeAll(async () => {
    // Dynamic imports so the module loads without a DATABASE_URL when skipped.
    prismaModule = await import('@/lib/prisma')
    repository = await import('../repository')

    await prismaModule.initWebPrisma()
    baseClient = globalThis.prisma!

    const { PrismaClient } = await import('@prisma/client')
    const { PrismaPg } = await import('@prisma/adapter-pg')
    const { Pool } = await import('pg')
    controlClient = new PrismaClient({
      adapter: new PrismaPg(new Pool({ connectionString: DATABASE_URL })),
    })

    const user = await controlClient.user.create({
      data: {
        email: `e2e-review-${randomUUID()}@arche.local`,
        slug: `e2e-review-${randomUUID()}`,
        passwordHash: 'not-a-real-hash',
      },
    })
    userId = user.id
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    globalThis.prisma = baseClient
    if (userId) await controlClient.user.deleteMany({ where: { id: userId } })
    await Promise.allSettled([controlClient.$disconnect(), baseClient.$disconnect()])
  })

  it('rejects a draft save built on a stale read instead of overwriting a newer one', async () => {
    const changeId = await seedChange()

    // Pause the first writer right after it reads the row, so the second writer
    // commits against the same snapshot the first one is still holding.
    let markRead!: () => void
    const rowRead = new Promise<void>((resolve) => {
      markRead = resolve
    })
    let releaseWriter!: () => void
    const writerGate = new Promise<void>((resolve) => {
      releaseWriter = resolve
    })
    let gateArmed = true

    const gatedClient = baseClient.$extends({
      query: {
        knowledgeReviewChange: {
          async findFirst({ args, query }) {
            const result = await query(args)
            if (gateArmed) {
              gateArmed = false
              markRead()
              await writerGate
            }
            return result
          },
        },
      },
    })
    vi.stubGlobal('prisma', gatedClient)

    const firstSave = repository.saveKnowledgeReviewDraft({
      actor: 'alice',
      changeId,
      content: '# Preference\n\nFirst edit.\n',
      userId,
    })
    await rowRead

    // Second autosave lands while the first is still paused on its stale read.
    const second = await repository.saveKnowledgeReviewDraft({
      actor: 'alice',
      changeId,
      content: '# Preference\n\nSecond edit.\n',
      userId,
    })
    expect(second).not.toBeNull()

    releaseWriter()
    const first = await firstSave

    // `open -> open` leaves the status untouched, so the status guard alone let
    // the stale writer through and its older content clobbered the newer save.
    expect(first).toBeNull()

    const stored = await controlClient.knowledgeReviewChange.findUniqueOrThrow({ where: { id: changeId } })
    expect(stored.proposedContent).toBe('# Preference\n\nSecond edit.\n')

    const trail = await readAuditTrail(changeId)
    expect(trail.some((entry) => entry.action === 'created')).toBe(true)

    await controlClient.knowledgeReviewChange.deleteMany({ where: { id: changeId } })
  })

  it('does not lose the needs_rebase audit entry when a draft save races it', async () => {
    const changeId = await seedChange()

    let markRead!: () => void
    const rowRead = new Promise<void>((resolve) => {
      markRead = resolve
    })
    let releaseWriter!: () => void
    const writerGate = new Promise<void>((resolve) => {
      releaseWriter = resolve
    })
    let gateArmed = true

    const gatedClient = baseClient.$extends({
      query: {
        knowledgeReviewChange: {
          async findFirst({ args, query }) {
            const result = await query(args)
            if (gateArmed) {
              gateArmed = false
              markRead()
              await writerGate
            }
            return result
          },
        },
      },
    })
    vi.stubGlobal('prisma', gatedClient)

    // The autosave reads first and is paused holding a stale trail.
    const draftSave = repository.saveKnowledgeReviewDraft({
      actor: 'alice',
      changeId,
      content: '# Preference\n\nEdited while rebase was detected.\n',
      userId,
    })
    await rowRead

    // Apply detects the file moved underneath and marks the change needs_rebase.
    const rebased = await repository.markKnowledgeReviewChangeNeedsRebase({
      actualContent: '# Preference\n\nChanged upstream.\n',
      actualHash: 'sha256:actual',
      actor: 'system',
      changeId,
      userId,
    })
    expect(rebased?.status).toBe('needs_rebase')

    releaseWriter()
    await draftSave

    const trail = await readAuditTrail(changeId)
    // The needs_rebase entry is the audit record of a real state change; a
    // concurrent autosave must not overwrite it out of the trail.
    expect(trail.some((entry) => entry.action === 'needs_rebase')).toBe(true)

    const stored = await controlClient.knowledgeReviewChange.findUniqueOrThrow({ where: { id: changeId } })
    expect(stored.status).toBe('needs_rebase')

    await controlClient.knowledgeReviewChange.deleteMany({ where: { id: changeId } })
  })

  it('keeps the audit trail bounded across repeated autosaves', async () => {
    const changeId = await seedChange()

    for (let index = 0; index < 25; index += 1) {
      const saved = await repository.saveKnowledgeReviewDraft({
        actor: 'alice',
        changeId,
        content: `# Preference\n\nEdit ${index}.\n`,
        userId,
      })
      expect(saved).not.toBeNull()
    }

    const trail = await readAuditTrail(changeId)
    // Every keystroke batch used to append its own entry, growing the JSON
    // column without bound for the lifetime of the proposal.
    const draftEntries = trail.filter((entry) => entry.action === 'draft_saved')
    expect(draftEntries.length).toBe(1)
    expect(trail).toHaveLength(2)

    const stored = await controlClient.knowledgeReviewChange.findUniqueOrThrow({ where: { id: changeId } })
    expect(stored.proposedContent).toBe('# Preference\n\nEdit 24.\n')

    await controlClient.knowledgeReviewChange.deleteMany({ where: { id: changeId } })
  })
})

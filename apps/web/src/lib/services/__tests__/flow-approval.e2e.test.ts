import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getFlowDefinitionRevision } from '@/lib/flows/sharing-approval'

describe.runIf(!!process.env.DATABASE_URL)('flow approval against PostgreSQL', () => {
  let client: import('@prisma/client').PrismaClient
  let service: typeof import('@/lib/services/flow-crud')
  const userId = randomUUID()
  const definition = { version: 1, nodes: [{ promptTemplate: 'Reviewed instructions' }] }
  const updatedAt = new Date('2026-01-01T00:00:00.000Z')

  beforeAll(async () => {
    const db = await import('@/lib/prisma')
    await db.initWebPrisma()
    client = globalThis.prisma!
    service = await import('@/lib/services/flow-crud')
    await client.user.create({ data: { id: userId, email: `${userId}@example.invalid`, slug: `approval-${userId}`, passwordHash: 'fixture' } })
  })

  afterAll(async () => {
    if (client) {
      await client.user.delete({ where: { id: userId } })
      await client.$disconnect()
    }
  })

  it('stores and revokes approval for the reviewed definition', async () => {
    const flow = await client.flow.create({ data: { userId, name: 'Reviewed', definition, visibility: 'team', organizationCanRun: true, updatedAt } })
    const revision = getFlowDefinitionRevision(definition)
    expect(await service.setFlowSharingApproval(flow.id, updatedAt, definition, revision)).toBe(true)
    const approved = await client.flow.findUniqueOrThrow({ where: { id: flow.id } })
    expect(approved.organizationApprovedHash).toBe(revision)
    expect(await service.setFlowSharingApproval(flow.id, approved.updatedAt, definition, null)).toBe(true)
    expect((await client.flow.findUniqueOrThrow({ where: { id: flow.id } })).organizationApprovedHash).toBeNull()
  })

  it('rejects a changed definition even if concurrent writes share the same timestamp', async () => {
    const flow = await client.flow.create({ data: { userId, name: 'Raced', definition, visibility: 'team', organizationCanRun: true, updatedAt } })
    await client.flow.update({ where: { id: flow.id }, data: { definition: { version: 1, nodes: [{ promptTemplate: 'Changed after review' }] }, updatedAt } })
    expect(await service.setFlowSharingApproval(flow.id, updatedAt, definition, getFlowDefinitionRevision(definition))).toBe(false)
    expect((await client.flow.findUniqueOrThrow({ where: { id: flow.id } })).organizationApprovedHash).toBeNull()
  })
})

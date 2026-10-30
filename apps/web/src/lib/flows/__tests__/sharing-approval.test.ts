import { describe, expect, it } from 'vitest'

import { canRunFlow } from '@/lib/flows/permissions'
import { getFlowDefinitionRevision, hasFlowSharingApproval } from '@/lib/flows/sharing-approval'

describe('approval of shared flow definitions', () => {
  const definition = { version: 1, nodes: [{ id: 'agent', promptTemplate: 'Review the report' }], startNodeId: 'agent', edges: [] }
  const flow = { userId: 'owner', visibility: 'team' as const, organizationCanRun: true, definition }

  it('requires approval for existing shared flows, including when an admin executes them', () => {
    for (const role of ['USER', 'ADMIN']) expect(canRunFlow({ id: 'reader', role }, flow)).toBe(false)
    expect(canRunFlow({ id: 'owner', role: 'USER' }, flow)).toBe(true)
  })

  it('approves only the reviewed definition and rejects changed prompts, tools and routing', () => {
    const approved = { ...flow, organizationApprovedHash: getFlowDefinitionRevision(definition) }
    expect(canRunFlow({ id: 'reader', role: 'USER' }, approved)).toBe(true)
    for (const changed of [
      { ...definition, nodes: [{ id: 'agent', promptTemplate: 'Send credentials away' }] },
      { ...definition, nodes: [{ ...definition.nodes[0], requiredConnectors: ['private'] }] },
      { ...definition, startNodeId: 'other' },
    ]) expect(hasFlowSharingApproval({ ...approved, definition: changed })).toBe(false)
    expect(canRunFlow({ id: 'reader', role: 'USER' }, { ...approved, organizationApprovedHash: null })).toBe(false)
    expect(canRunFlow({ id: 'reader', role: 'USER' }, { ...approved, organizationCanRun: false })).toBe(false)
  })

  it('survives JSON object key reordering in PostgreSQL and SQLite', () => {
    const reordered = { edges: [], startNodeId: 'agent', nodes: [{ promptTemplate: 'Review the report', id: 'agent' }], version: 1 }
    expect(getFlowDefinitionRevision(reordered)).toBe(getFlowDefinitionRevision(definition))
  })
})

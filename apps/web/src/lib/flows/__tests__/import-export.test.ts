import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listFlowAgentOptions: vi.fn(),
}))

vi.mock('@/lib/flows/agents', () => ({
  listFlowAgentOptions: mocks.listFlowAgentOptions,
}))

import { createFlowTemplate, FLOW_TEMPLATE_FORMAT, validateFlowTemplateImport } from '@/lib/flows/import-export'
import { createDefaultFlowDefinition } from '@/lib/flows/validation'

describe('flow import/export helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listFlowAgentOptions.mockResolvedValue({ ok: true, agents: [] })
  })

  it('creates portable JSON templates while preserving schedule fields', () => {
    const definition = createDefaultFlowDefinition()
    const template = createFlowTemplate({
      cronExpression: '0 9 * * 1',
      definition,
      description: 'Weekly automation',
      enabled: true,
      name: 'Weekly review',
      timezone: 'Europe/Madrid',
    })

    expect(template).toEqual({
      cronExpression: '0 9 * * 1',
      definition,
      description: 'Weekly automation',
      enabled: true,
      format: FLOW_TEMPLATE_FORMAT,
      name: 'Weekly review',
      timezone: 'Europe/Madrid',
    })
    expect(template).not.toHaveProperty('id')
    expect(template).not.toHaveProperty('createdAt')
  })

  it('validates templates into draft create payloads without rejecting portable agent ids', async () => {
    const definition = createDefaultFlowDefinition()
    definition.nodes = definition.nodes.map((node) => (
      node.type === 'agent' ? { ...node, targetAgentId: 'agent-from-another-workspace' } : node
    ))

    const result = await validateFlowTemplateImport({
      cronExpression: '0 9 * * 1',
      definition,
      description: ' Imported description ',
      enabled: true,
      format: FLOW_TEMPLATE_FORMAT,
      name: ' Imported flow ',
      timezone: 'UTC',
    })

    expect(result).toEqual({
      ok: true,
      payload: {
        cronExpression: '0 9 * * 1',
        definition,
        description: 'Imported description',
        enabled: true,
        name: 'Imported flow',
        organizationCanRun: false,
        timezone: 'UTC',
        visibility: 'private',
      },
      template: {
        cronExpression: '0 9 * * 1',
        definition,
        description: 'Imported description',
        enabled: true,
        format: FLOW_TEMPLATE_FORMAT,
        name: 'Imported flow',
        timezone: 'UTC',
      },
      warnings: [],
    })
    expect(mocks.listFlowAgentOptions).not.toHaveBeenCalled()
  })

  it('warns when an enabled template has no schedule', async () => {
    const result = await validateFlowTemplateImport({
      cronExpression: null,
      definition: createDefaultFlowDefinition(),
      enabled: true,
      format: FLOW_TEMPLATE_FORMAT,
      name: 'Needs schedule',
      timezone: 'UTC',
    })

    expect(result).toMatchObject({
      ok: true,
      payload: { cronExpression: null, enabled: true, name: 'Needs schedule' },
      warnings: [{ code: 'schedule_required' }],
    })
  })

  it('rejects invalid templates before creating drafts', async () => {
    await expect(validateFlowTemplateImport({ format: 'other' }))
      .resolves.toEqual({ ok: false, error: 'invalid_flow_template_format' })

    await expect(validateFlowTemplateImport({
      cronExpression: null,
      definition: { edges: [], nodes: [], startNodeId: '', version: 1 },
      enabled: false,
      format: FLOW_TEMPLATE_FORMAT,
      name: 'Broken',
      timezone: 'UTC',
    })).resolves.toEqual({ ok: false, error: 'invalid_definition' })

    await expect(validateFlowTemplateImport({
      cronExpression: 'not cron',
      definition: createDefaultFlowDefinition(),
      enabled: true,
      format: FLOW_TEMPLATE_FORMAT,
      name: 'Broken schedule',
      timezone: 'UTC',
    })).resolves.toEqual({ ok: false, error: 'invalid_cron_expression' })
  })
})

import { readFile } from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listFlowAgentOptions: vi.fn(),
}))

vi.mock('@/lib/flows/agents', () => ({
  listFlowAgentOptions: mocks.listFlowAgentOptions,
}))

import { createFlowTemplate, FLOW_TEMPLATE_FORMAT, validateFlowTemplateImport } from '@/lib/flows/import-export'
import { createDefaultFlowDefinition } from '@/lib/flows/validation'

type FlowTemplateContractCase = {
  expected: {
    cronExpression?: string | null
    edgeIds?: string[]
    error?: string
    ok: boolean
  }
  input: Record<string, unknown>
  name: string
}

async function readFlowTemplateContractCases(): Promise<FlowTemplateContractCase[]> {
  const file = new URL('../../../../../../resources/flow-template-contract-cases.json', import.meta.url)
  return JSON.parse(await readFile(file, 'utf8')) as FlowTemplateContractCase[]
}

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
      draftPayload: {
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
      draftPayload: { cronExpression: null, enabled: true, name: 'Needs schedule' },
      warnings: [{ code: 'schedule_required' }],
    })
  })

  it('matches the shared flow template contract fixtures', async () => {
    const cases = await readFlowTemplateContractCases()

    for (const contractCase of cases) {
      const result = await validateFlowTemplateImport({
        format: FLOW_TEMPLATE_FORMAT,
        ...contractCase.input,
      })

      expect(result.ok, contractCase.name).toBe(contractCase.expected.ok)
      if (!contractCase.expected.ok) {
        expect(result, contractCase.name).toEqual({ ok: false, error: contractCase.expected.error })
        continue
      }

      expect(result.ok, contractCase.name).toBe(true)
      if (!result.ok) continue
      expect(result.draftPayload.cronExpression, contractCase.name).toBe(contractCase.expected.cronExpression ?? null)
      if (contractCase.expected.edgeIds) {
        expect(result.draftPayload.definition.edges.map((edge) => edge.id), contractCase.name)
          .toEqual(contractCase.expected.edgeIds)
      }
    }
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

  it('rejects malformed template fields before creating drafts', async () => {
    const base = {
      cronExpression: null,
      definition: createDefaultFlowDefinition(),
      enabled: false,
      format: FLOW_TEMPLATE_FORMAT,
      name: 'Flow',
      timezone: 'UTC',
    }

    const cases = [
      { error: 'invalid_name', input: { ...base, name: '   ' } },
      { error: 'invalid_cron_expression', input: { ...base, cronExpression: 42 } },
      { error: 'invalid_timezone', input: { ...base, timezone: 42 } },
      { error: 'invalid_timezone', input: { ...base, timezone: 'Mars/Base' } },
      { error: 'invalid_enabled', input: { ...base, enabled: 'yes' } },
    ]

    for (const testCase of cases) {
      await expect(validateFlowTemplateImport(testCase.input))
        .resolves.toEqual({ ok: false, error: testCase.error })
    }
  })

  it('returns payload validation errors after parsing the template source', async () => {
    const definition = createDefaultFlowDefinition()
    definition.nodes = definition.nodes.map((node) => (
      node.type === 'agent' ? { ...node, promptTemplate: '{{steps.missing.output}}' } : node
    ))

    await expect(validateFlowTemplateImport({
      cronExpression: null,
      definition,
      enabled: false,
      format: FLOW_TEMPLATE_FORMAT,
      name: 'Flow',
      timezone: 'UTC',
    })).resolves.toEqual({ ok: false, error: 'unknown_template_variable:steps.missing.output' })
  })
})

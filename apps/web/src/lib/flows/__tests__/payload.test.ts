import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listFlowAgentOptions: vi.fn(),
}))

vi.mock('@/lib/flows/agents', () => ({
  listFlowAgentOptions: mocks.listFlowAgentOptions,
}))

import { validateFlowPayload } from '@/lib/flows/payload'
import { createDefaultFlowDefinition } from '@/lib/flows/validation'

describe('validateFlowPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listFlowAgentOptions.mockResolvedValue({
      ok: true,
      agents: [{ displayName: 'Writer', id: 'writer', isPrimary: false }],
    })
  })

  it('accepts a valid create payload', async () => {
    const definition = createDefaultFlowDefinition()
    definition.nodes = definition.nodes.map((node) => node.type === 'agent' ? { ...node, targetAgentId: 'writer' } : node)

    await expect(validateFlowPayload({
      cronExpression: '0 9 * * 1',
      definition,
      description: ' Does work ',
      enabled: true,
      name: ' Weekly Flow ',
      timezone: 'UTC',
    }, 'create')).resolves.toEqual({
      ok: true,
      value: {
        cronExpression: '0 9 * * 1',
        definition,
        description: 'Does work',
        enabled: true,
        name: 'Weekly Flow',
        timezone: 'UTC',
      },
    })
  })

  it('requires a schedule when enabling a flow', async () => {
    await expect(validateFlowPayload({
      cronExpression: null,
      definition: createDefaultFlowDefinition(),
      description: null,
      enabled: true,
      name: 'Weekly Flow',
      timezone: 'UTC',
    }, 'create')).resolves.toEqual({ ok: false, error: 'schedule_required', status: 400 })
  })

  it('rejects unknown target agents', async () => {
    const definition = createDefaultFlowDefinition()
    definition.nodes = definition.nodes.map((node) => node.type === 'agent' ? { ...node, targetAgentId: 'missing' } : node)

    await expect(validateFlowPayload({
      cronExpression: null,
      definition,
      description: null,
      enabled: false,
      name: 'Weekly Flow',
      timezone: 'UTC',
    }, 'create')).resolves.toEqual({ ok: false, error: 'unknown_target_agent', status: 400 })
  })

  it('uses the existing timezone as fallback for update cron validation', async () => {
    await expect(validateFlowPayload({ cronExpression: '0 9 * * 1' }, 'update', { fallbackTimezone: 'UTC' }))
      .resolves.toEqual({ ok: true, value: { cronExpression: '0 9 * * 1' } })
  })

  it('rejects malformed scalar update fields', async () => {
    await expect(validateFlowPayload(null, 'update'))
      .resolves.toEqual({ ok: false, error: 'invalid_body', status: 400 })
    await expect(validateFlowPayload({ name: '   ' }, 'update'))
      .resolves.toEqual({ ok: false, error: 'invalid_name', status: 400 })
    await expect(validateFlowPayload({ timezone: 5 }, 'update'))
      .resolves.toEqual({ ok: false, error: 'invalid_timezone', status: 400 })
    await expect(validateFlowPayload({ timezone: 'Mars/Base' }, 'update'))
      .resolves.toEqual({ ok: false, error: 'invalid_timezone', status: 400 })
    await expect(validateFlowPayload({ cronExpression: '0 9 * * 1' }, 'update'))
      .resolves.toEqual({ ok: false, error: 'invalid_timezone', status: 400 })
    await expect(validateFlowPayload({ cronExpression: 'not cron' }, 'update', { fallbackTimezone: 'UTC' }))
      .resolves.toEqual({ ok: false, error: 'invalid_cron_expression', status: 400 })
    await expect(validateFlowPayload({ cronExpression: 42 }, 'update'))
      .resolves.toEqual({ ok: false, error: 'invalid_cron_expression', status: 400 })
    await expect(validateFlowPayload({ enabled: 'yes' }, 'update'))
      .resolves.toEqual({ ok: false, error: 'invalid_enabled', status: 400 })
  })

  it('rejects invalid definitions and templates', async () => {
    await expect(validateFlowPayload({ definition: { edges: [], nodes: [], startNodeId: '', version: 1 } }, 'update'))
      .resolves.toEqual({ ok: false, error: 'invalid_definition', status: 400 })

    const agentTemplateDefinition = createDefaultFlowDefinition()
    agentTemplateDefinition.nodes = agentTemplateDefinition.nodes.map((node) => (
      node.type === 'agent' ? { ...node, promptTemplate: '{{missing.output}}' } : node
    ))
    await expect(validateFlowPayload({ definition: agentTemplateDefinition }, 'update'))
      .resolves.toEqual({ ok: false, error: 'unknown_template_variable:missing.output', status: 400 })

    await expect(validateFlowPayload({
      definition: {
        edges: [],
        nodes: [{ id: 'human-1', instructions: '{{missing.output}}', name: 'Human', required: true, type: 'human' }],
        startNodeId: 'human-1',
        version: 1,
      },
    }, 'update')).resolves.toEqual({ ok: false, error: 'unknown_template_variable:missing.output', status: 400 })

    await expect(validateFlowPayload({
      definition: {
        edges: [],
        nodes: [{ evaluatorPrompt: '{{missing.output}}', id: 'condition-1', mode: 'ai', name: 'Condition', type: 'condition' }],
        startNodeId: 'condition-1',
        version: 1,
      },
    }, 'update')).resolves.toEqual({ ok: false, error: 'unknown_template_variable:missing.output', status: 400 })

    await expect(validateFlowPayload({
      definition: {
        edges: [],
        nodes: [{ id: 'compaction-1', name: 'Compact', promptTemplate: '{{missing.output}}', type: 'compaction' }],
        startNodeId: 'compaction-1',
        version: 1,
      },
    }, 'update')).resolves.toEqual({ ok: false, error: 'unknown_template_variable:missing.output', status: 400 })

    await expect(validateFlowPayload({
      definition: {
        edges: [],
        nodes: [{ id: 'slack-1', messageMode: 'template', messageTemplate: '{{missing.output}}', name: 'Notify', target: { type: 'dm', userId: 'user-1' }, type: 'slack' }],
        startNodeId: 'slack-1',
        version: 1,
      },
    }, 'update')).resolves.toEqual({ ok: false, error: 'unknown_template_variable:missing.output', status: 400 })
  })

  it('maps agent listing failures to response status codes', async () => {
    const definition = createDefaultFlowDefinition()
    definition.nodes = definition.nodes.map((node) => node.type === 'agent' ? { ...node, targetAgentId: 'writer' } : node)
    mocks.listFlowAgentOptions.mockResolvedValueOnce({ ok: false, error: 'kb_unavailable' })

    await expect(validateFlowPayload({ definition }, 'update'))
      .resolves.toEqual({ ok: false, error: 'kb_unavailable', status: 503 })
  })
})

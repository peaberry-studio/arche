import { describe, expect, it } from 'vitest'

import { buildFlowTemplateContext, renderFlowTemplate, validateFlowTemplateVariables } from '@/lib/flows/template'

const now = new Date('2026-05-12T10:00:00.000Z')

describe('flow template helpers', () => {
  it('renders built-in, step, and human variables', () => {
    const context = buildFlowTemplateContext({
      flowName: 'Launch',
      previousOutput: 'previous text',
      runId: 'run-1',
      steps: [
        {
          compactedOutput: 'compact output',
          createdAt: now,
          error: null,
          finishedAt: now,
          humanResponse: null,
          id: 'step-1',
          input: null,
          nodeId: 'agent-1',
          nodeName: 'Agent',
          nodeType: 'agent',
          rawOutput: 'raw output',
          runId: 'run-1',
          startedAt: now,
          status: 'succeeded',
          updatedAt: now,
        },
        {
          compactedOutput: null,
          createdAt: now,
          error: null,
          finishedAt: now,
          humanResponse: 'approved',
          id: 'step-2',
          input: null,
          nodeId: 'human-1',
          nodeName: 'Human',
          nodeType: 'human',
          rawOutput: null,
          runId: 'run-1',
          startedAt: now,
          status: 'succeeded',
          updatedAt: now,
        },
      ],
    })

    expect(renderFlowTemplate('{{flow.name}} {{run.id}} {{previous.output}} {{steps.agent-1.output}} {{human.human-1.response}}', context))
      .toEqual({ ok: true, value: 'Launch run-1 previous text compact output approved' })
  })

  it('reports unknown variables', () => {
    const result = validateFlowTemplateVariables('{{steps.missing.output}}', new Set(['agent-1']))

    expect(result).toEqual({ ok: false, error: 'unknown_template_variable:steps.missing.output' })
  })
})

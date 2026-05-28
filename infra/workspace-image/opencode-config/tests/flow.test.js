import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

import { propose } from '../tools/flow.js'

async function readFlowTemplateContractCases() {
  const file = new URL('../../../../resources/flow-template-contract-cases.json', import.meta.url)
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

function parseToolOutput(output) {
  return JSON.parse(output)
}

function createDefinition(overrides = {}) {
  return {
    version: 1,
    startNodeId: 'agent-1',
    nodes: [
      {
        id: 'agent-1',
        type: 'agent',
        name: 'Draft summary',
        targetAgentId: 'workspace-specific-agent',
        promptTemplate: 'Summarize the latest weekly metrics.',
        compactOutput: false,
      },
    ],
    edges: [],
    layout: { nodes: [{ nodeId: 'agent-1', x: 120, y: 120 }] },
    ...overrides,
  }
}

test('flow_propose returns a portable validated flow template', async () => {
  const output = parseToolOutput(await propose.execute({
    name: ' Weekly review ',
    description: ' Draft and review weekly metrics ',
    definition: createDefinition(),
    enabled: true,
    cronExpression: '0 9 * * 1',
    timezone: 'UTC',
  }))

  assert.equal(output.ok, true)
  assert.equal(output.format, 'arche-flow-template/v1')
  assert.deepEqual(output.validation, { ok: true })
  assert.equal(output.template.format, 'arche-flow-template/v1')
  assert.equal(output.template.name, 'Weekly review')
  assert.equal(output.template.description, 'Draft and review weekly metrics')
  assert.equal(output.template.enabled, true)
  assert.equal(output.template.cronExpression, '0 9 * * 1')
  assert.equal(output.template.timezone, 'UTC')
  assert.equal(output.template.definition.nodes[0].targetAgentId, null)
  assert.equal(output.warnings[0].code, 'target_agent_reset')
})

test('flow_propose warns when enabled schedules are incomplete', async () => {
  const output = parseToolOutput(await propose.execute({
    name: 'Needs schedule',
    definition: createDefinition({ nodes: [
      {
        id: 'agent-1',
        type: 'agent',
        name: 'Draft summary',
        targetAgentId: null,
        promptTemplate: 'Summarize the latest weekly metrics.',
        compactOutput: false,
      },
    ] }),
    enabled: true,
    timezone: 'UTC',
  }))

  assert.equal(output.ok, true)
  assert.equal(output.template.enabled, true)
  assert.equal(output.template.cronExpression, null)
  assert.deepEqual(output.warnings, [{
    code: 'schedule_required',
    message: 'This template is enabled but has no cron schedule. Add a schedule or disable it before saving.',
  }])
})

test('flow_propose rejects invalid definitions', async () => {
  const output = parseToolOutput(await propose.execute({
    name: 'Broken flow',
    definition: createDefinition({ startNodeId: 'missing' }),
  }))

  assert.equal(output.ok, false)
  assert.equal(output.format, 'arche-flow-template/v1')
  assert.equal(output.error, 'unknown_start_node')
  assert.equal(output.helpSkill, 'arche-flow-authoring')
  assert.equal(output.help.definition.version, 1)
  assert.deepEqual(output.help.nodeTypes, ['agent', 'human', 'condition', 'slack', 'merge', 'compaction'])
  assert.deepEqual(output.validation, {
    ok: false,
    error: 'unknown_start_node',
    hint: 'Use the arche-flow-authoring skill for the FlowDefinition schema, supported node types, agent targeting rules, and template variables.',
  })
})

test('flow_propose returns actionable help for invalid definition version', async () => {
  const output = parseToolOutput(await propose.execute({
    name: 'Broken flow',
    definition: {
      format: 'arche-flow-template/v1',
      name: 'Wrong nesting',
    },
  }))

  assert.equal(output.ok, false)
  assert.equal(output.error, 'invalid_definition_version')
  assert.equal(output.helpSkill, 'arche-flow-authoring')
  assert.match(output.hint, /Pass only FlowDefinition as definition/)
  assert.ok(output.help.templateVariables.includes('{{previous.output}}'))
})

test('flow_propose matches the shared flow template contract fixtures', async () => {
  const cases = await readFlowTemplateContractCases()

  for (const contractCase of cases) {
    const output = parseToolOutput(await propose.execute(contractCase.input))
    assert.equal(output.ok, contractCase.expected.ok, contractCase.name)
    if (!contractCase.expected.ok) {
      assert.equal(output.error, contractCase.expected.error, contractCase.name)
      continue
    }

    assert.equal(output.template.cronExpression, contractCase.expected.cronExpression ?? null, contractCase.name)
    if (contractCase.expected.edgeIds) {
      assert.deepEqual(output.template.definition.edges.map((edge) => edge.id), contractCase.expected.edgeIds, contractCase.name)
    }
  }
})

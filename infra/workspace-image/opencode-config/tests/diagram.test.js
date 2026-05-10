import test from 'node:test'
import assert from 'node:assert/strict'

import { create } from '../tools/diagram.js'

function parseToolOutput(output) {
  return JSON.parse(output)
}

async function createDiagram(overrides = {}) {
  return parseToolOutput(await create.execute({
    title: 'Support flow',
    source: 'flowchart TD\n  A[Request] --> B[Resolve]',
    ...overrides,
  }))
}

test('diagram_create returns a safe Mermaid diagram payload', async () => {
  const output = await createDiagram({
    title: '  Support flow  ',
    source: 'flowchart TD\r\n  A[Request] --> B[Resolve]\r\n',
  })

  assert.equal(output.ok, true)
  assert.equal(output.format, 'arche-diagram/v1')
  assert.equal(output.diagram.syntax, 'mermaid')
  assert.equal(output.diagram.title, 'Support flow')
  assert.equal(output.diagram.source, 'flowchart TD\n  A[Request] --> B[Resolve]')
})

test('diagram_create accepts the supported Mermaid diagram families', async () => {
  const sources = [
    'flowchart LR\n  A --> B',
    'graph TD\n  A --> B',
    'sequenceDiagram\n  Alice->>Bob: Hello',
    'mindmap\n  root((Project))\n    Research',
  ]

  for (const source of sources) {
    const output = await createDiagram({ source })
    assert.equal(output.ok, true)
  }
})

test('diagram_create rejects unsupported or unsafe Mermaid input', async () => {
  const cases = [
    { source: 'classDiagram\n  Animal <|-- Duck' },
    { source: '%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\n  A --> B' },
    { source: 'flowchart TD\n  A[<b>Unsafe</b>] --> B' },
    { source: 'flowchart TD\n  A[Docs https://example.com] --> B' },
    { source: 'flowchart TD\n  A --> B\n  click A callback' },
    { title: '<b>Flow</b>' },
    { source: `flowchart TD\n  A[${'x'.repeat(20_001)}]` },
  ]

  for (const overrides of cases) {
    const output = await createDiagram(overrides)
    assert.equal(output.ok, false)
    assert.equal(output.error, 'invalid_diagram_input')
  }
})

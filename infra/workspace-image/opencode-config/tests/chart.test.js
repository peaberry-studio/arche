import test from 'node:test'
import assert from 'node:assert/strict'

import { create } from '../tools/chart.js'

function parseToolOutput(output) {
  return JSON.parse(output)
}

async function createChart(overrides = {}) {
  return parseToolOutput(await create.execute({
    type: 'bar',
    title: 'Quarterly revenue',
    xField: 'quarter',
    yField: 'revenue',
    data: [
      { quarter: 'Q1', revenue: 10 },
      { quarter: 'Q2', revenue: 20 },
    ],
    ...overrides,
  }))
}

test('chart_create returns a safe Vega-Lite chart payload', async () => {
  const output = await createChart({
    title: '  Quarterly revenue  ',
    sourceNote: 'Internal forecast',
  })

  assert.equal(output.ok, true)
  assert.equal(output.format, 'arche-chart/v1')
  assert.equal(output.chart.title, 'Quarterly revenue')
  assert.equal(output.chart.sourceNote, 'Internal forecast')
  assert.equal(output.chart.spec.$schema, 'https://vega.github.io/schema/vega-lite/v5.json')
  assert.equal(output.chart.spec.mark, 'bar')
  assert.deepEqual(output.chart.spec.data.values, [
    { quarter: 'Q1', revenue: 10 },
    { quarter: 'Q2', revenue: 20 },
  ])
  assert.deepEqual(output.chart.spec.encoding.x, { field: 'quarter', type: 'nominal' })
  assert.deepEqual(output.chart.spec.encoding.y, { field: 'revenue', type: 'quantitative' })
  assert.equal(output.chart.spec.encoding.tooltip, undefined)
})

test('chart_create creates pie charts with arc encoding', async () => {
  const output = await createChart({
    type: 'pie',
    data: [
      { quarter: 'Q1', revenue: 0 },
      { quarter: 'Q2', revenue: 20 },
    ],
  })

  assert.equal(output.ok, true)
  assert.equal(output.chart.spec.mark, 'arc')
  assert.deepEqual(output.chart.spec.encoding.theta, { field: 'revenue', type: 'quantitative' })
  assert.deepEqual(output.chart.spec.encoding.color, { field: 'quarter', type: 'nominal' })
  assert.equal(output.chart.spec.encoding.tooltip, undefined)
})

test('chart_create creates scatter charts with numeric x values', async () => {
  const output = await createChart({
    type: 'scatter',
    xField: 'cost',
    yField: 'revenue',
    data: [
      { cost: 1, revenue: 10 },
      { cost: 2, revenue: 20 },
    ],
  })

  assert.equal(output.ok, true)
  assert.equal(output.chart.spec.mark, 'point')
  assert.deepEqual(output.chart.spec.encoding.x, { field: 'cost', type: 'quantitative' })
})

test('chart_create rejects malformed and unsafe chart inputs', async () => {
  const cases = [
    { type: 'heatmap' },
    { title: '<b>Revenue</b>' },
    { sourceNote: 'See https://example.com' },
    { yField: 'missing' },
    { data: [{ quarter: 'Q1', revenue: '10' }] },
    { data: [{ quarter: 'Q1', revenue: Number.POSITIVE_INFINITY }] },
    { type: 'scatter', xField: 'quarter' },
    { type: 'pie', data: [{ quarter: 'Q1', revenue: -1 }] },
    { data: Array.from({ length: 1001 }, (_, index) => ({ quarter: `Q${index}`, revenue: index })) },
    { data: [Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`column_${index}`, index]))] },
  ]

  for (const overrides of cases) {
    const output = await createChart(overrides)
    assert.equal(output.ok, false)
    assert.equal(output.error, 'invalid_chart_input')
  }
})

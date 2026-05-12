import test from 'node:test'
import assert from 'node:assert/strict'

import { create } from '../tools/chart.js'

const EXPECTED_CHART_INPUT_EXAMPLE = {
  type: 'bar',
  title: 'Variation by segment',
  xField: 'segment',
  yField: 'change_percent',
  data: [
    { segment: 'Mexico', change_percent: 60 },
    { segment: 'Rest of countries', change_percent: -9.1 },
  ],
  sourceNote: 'Mixpanel, last 7 full days vs previous 7 days',
}

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
    { overrides: { type: 'heatmap' }, reason: 'invalid_chart_type', hint: /type field must be one of/ },
    { overrides: { title: '<b>Revenue</b>' }, reason: 'unsafe_text', hint: /plain text only/ },
    { overrides: { sourceNote: 'See https://example.com' }, reason: 'unsafe_text', hint: /plain text only/ },
    { overrides: { yField: 'missing' }, reason: 'missing_field', hint: /include both the xField and yField keys/ },
    {
      overrides: { data: [{ quarter: 'Q1', revenue: '10' }] },
      reason: 'y_not_numeric',
      hint: /yField value must be a finite number/,
    },
    {
      overrides: { data: [{ quarter: 'Q1', revenue: Number.POSITIVE_INFINITY }] },
      reason: 'non_finite_numeric',
      hint: /do not pass Infinity or NaN/,
    },
    {
      overrides: { type: 'scatter', xField: 'quarter' },
      reason: 'scatter_x_not_numeric',
      hint: /xField value to be a finite number/,
    },
    {
      overrides: { type: 'pie', data: [{ quarter: 'Q1', revenue: -1 }] },
      reason: 'pie_negative_value',
      hint: /zero or greater/,
    },
    {
      overrides: {
        data: Array.from({ length: 1001 }, (_, index) => ({ quarter: `Q${index}`, revenue: index })),
      },
      reason: 'row_limit_exceeded',
      hint: /at most 1000 rows/,
    },
    {
      overrides: {
        data: [Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`column_${index}`, index]))],
      },
      reason: 'column_limit_exceeded',
      hint: /at most 50 distinct columns/,
    },
  ]

  for (const { overrides, reason, hint } of cases) {
    const output = await createChart(overrides)
    assert.equal(output.ok, false)
    assert.equal(output.error, 'invalid_chart_input')
    assert.equal(output.reason, reason)
    assert.match(output.hint, hint)
    assert.match(output.hint, /requires inline data in the data field/)
    assert.deepEqual(output.example, EXPECTED_CHART_INPUT_EXAMPLE)
  }
})

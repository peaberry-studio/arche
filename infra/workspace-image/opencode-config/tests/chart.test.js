import test from 'node:test'
import assert from 'node:assert/strict'

import { create, render } from '../tools/chart.js'

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

test('chart_create description points to vega-lite fenced specs for persistent charts', () => {
  assert.ok(
    create.description.includes('vega-lite fenced'),
    'description should mention vega-lite fences',
  )
})

test('chart_create returns a safe Vega-Lite chart payload', async () => {
  const output = await createChart({
    title: '  Quarterly revenue  ',
    sourceNote: 'Internal forecast',
  })

  assert.equal(output.ok, true)
  assert.equal(output.format, 'arche-chart/v1')
  assert.equal(output.chart.title, 'Quarterly revenue')
  assert.equal(output.chart.sourceNote, 'Internal forecast')
  assert.equal(output.chart.spec.$schema, 'https://vega.github.io/schema/vega-lite/v6.json')
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
        data: Array.from({ length: 200001 }, (_, index) => ({ quarter: `Q${index}`, revenue: index })),
      },
      reason: 'row_limit_exceeded',
      hint: /at most 200000 rows/,
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

test('chart_create accepts titles and notes containing angle brackets and URLs', async () => {
  const output = await createChart({
    title: 'p99 latency < 100ms',
    sourceNote: 'Grafana, see https://example.com/dashboard',
  })

  assert.equal(output.ok, true)
  assert.equal(output.chart.title, 'p99 latency < 100ms')
  assert.equal(output.chart.sourceNote, 'Grafana, see https://example.com/dashboard')
})

test('chart_create accepts wide rows that the old column limit rejected', async () => {
  const output = await createChart({
    data: [Object.fromEntries([['quarter', 'Q1'], ['revenue', 10],
      ...Array.from({ length: 80 }, (_, index) => [`extra_${index}`, index])])],
  })

  assert.equal(output.ok, true)
})

test('chart_create bounds total cells, not just rows', async () => {
  // 20k rows x 60 columns = 1.2M cells: within the row limit, past the cell budget.
  const columns = Array.from({ length: 58 }, (_, index) => [`extra_${index}`, index])
  const output = await createChart({
    data: Array.from({ length: 20000 }, (_, index) => Object.fromEntries([
      ['quarter', `Q${index}`], ['revenue', index], ...columns,
    ])),
  })

  assert.equal(output.ok, false)
  assert.equal(output.reason, 'cell_limit_exceeded')
  assert.match(output.hint, /use chart_render with a fenced spec/)
})

test('chart_render passes a full Vega-Lite spec through unchanged', async () => {
  const spec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: [{ x: 1, g: 'a' }] },
    params: [{ name: 'sel', select: { type: 'point', fields: ['g'] }, bind: 'legend' }],
    hconcat: [
      { mark: 'geoshape', projection: { type: 'albersUsa' } },
      { mark: 'boxplot', encoding: { x: { field: 'x', type: 'quantitative' } } },
    ],
  }

  const output = parseToolOutput(await render.execute({
    title: 'Multi-view figure',
    spec: JSON.stringify(spec),
    sourceNote: 'Synthetic',
  }))

  assert.equal(output.ok, true)
  assert.equal(output.format, 'arche-chart/v1')
  assert.equal(output.chart.title, 'Multi-view figure')
  assert.deepEqual(output.chart.spec, spec)
})

test('chart_render description states that the full grammar is supported', () => {
  assert.match(render.description, /complete Vega-Lite grammar is supported/)
  assert.match(render.description, /vega\.github\.io\/vega-lite\/docs/)
})

test('chart_render rejects malformed specs', async () => {
  const cases = [
    { args: { title: 'T', spec: 'not json' }, reason: 'invalid_json' },
    { args: { title: 'T', spec: '[1,2,3]' }, reason: 'invalid_json' },
    { args: { title: 'T', spec: '   ' }, reason: 'invalid_spec_size' },
    { args: { title: '', spec: '{}' }, reason: 'invalid_title' },
  ]

  for (const { args, reason } of cases) {
    const output = parseToolOutput(await render.execute(args))
    assert.equal(output.ok, false, JSON.stringify(args))
    assert.equal(output.error, 'invalid_chart_spec')
    assert.equal(output.reason, reason)
  }
})

import { describe, expect, it } from 'vitest'

import { parseChartOutput } from '@/components/workspace/chat-panel/chart-output'
import { parseDiagramOutput } from '@/components/workspace/chat-panel/diagram-output'

const chartSpec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  autosize: { type: 'fit', contains: 'padding' },
  title: 'Revenue',
  data: { values: [{ quarter: 'Q1', revenue: 10 }] },
  height: 320,
  mark: 'bar',
  width: 'container',
  encoding: {
    x: { field: 'quarter', type: 'nominal' },
    y: { field: 'revenue', type: 'quantitative' },
  },
}

describe('parseChartOutput', () => {
  it('parses valid chart tool output', () => {
    const result = parseChartOutput(JSON.stringify({
      ok: true,
      format: 'arche-chart/v1',
      chart: {
        title: 'Revenue',
        sourceNote: 'Forecast',
        spec: chartSpec,
      },
    }))

    expect(result).toEqual({
      title: 'Revenue',
      sourceNote: 'Forecast',
      spec: chartSpec,
    })
  })

  it('rejects invalid or unsafe chart tool output', () => {
    expect(parseChartOutput('not-json')).toBeNull()
    expect(parseChartOutput(JSON.stringify({ ok: true, format: 'other', chart: {} }))).toBeNull()
    expect(parseChartOutput(JSON.stringify({
      ok: true,
      format: 'arche-chart/v1',
      chart: { title: '<b>Revenue</b>', spec: chartSpec },
    }))).toBeNull()
    expect(parseChartOutput(JSON.stringify({
      ok: true,
      format: 'arche-chart/v1',
      chart: {
        title: 'Revenue',
        spec: { ...chartSpec, data: { url: 'https://example.com/data.json', values: [] } },
      },
    }))).toBeNull()
  })

  it('rejects unsupported top-level Vega-Lite spec keys', () => {
    expect(parseChartOutput(JSON.stringify({
      ok: true,
      format: 'arche-chart/v1',
      chart: {
        title: 'Revenue',
        spec: {
          ...chartSpec,
          transform: [{ filter: 'datum.revenue > 0' }],
        },
      },
    }))).toBeNull()
  })

  it('rejects invalid allowed Vega-Lite layout fields', () => {
    for (const spec of [
      { ...chartSpec, width: 5000 },
      { ...chartSpec, autosize: { type: 'fit', resize: true } },
    ]) {
      expect(parseChartOutput(JSON.stringify({
        ok: true,
        format: 'arche-chart/v1',
        chart: {
          title: 'Revenue',
          spec,
        },
      }))).toBeNull()
    }
  })
})

describe('parseDiagramOutput', () => {
  it('parses valid Mermaid diagram tool output', () => {
    const result = parseDiagramOutput(JSON.stringify({
      ok: true,
      format: 'arche-diagram/v1',
      diagram: {
        syntax: 'mermaid',
        title: 'Support flow',
        source: 'flowchart TD\r\n  A --> B',
      },
    }))

    expect(result).toEqual({
      syntax: 'mermaid',
      title: 'Support flow',
      source: 'flowchart TD\n  A --> B',
    })
  })

  it('accepts a bare mindmap type line without trailing whitespace', () => {
    const result = parseDiagramOutput(JSON.stringify({
      ok: true,
      format: 'arche-diagram/v1',
      diagram: {
        syntax: 'mermaid',
        title: 'Plan',
        source: '%% comment\nmindmap\n  root((Plan))',
      },
    }))

    expect(result).toEqual({
      syntax: 'mermaid',
      title: 'Plan',
      source: '%% comment\nmindmap\n  root((Plan))',
    })
  })

  it('rejects invalid or unsafe Mermaid diagram output', () => {
    expect(parseDiagramOutput('not-json')).toBeNull()
    expect(parseDiagramOutput(JSON.stringify({ ok: true, format: 'other', diagram: {} }))).toBeNull()
    expect(parseDiagramOutput(JSON.stringify({
      ok: true,
      format: 'arche-diagram/v1',
      diagram: {
        syntax: 'mermaid',
        title: 'Unsafe',
        source: '%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\n  A --> B',
      },
    }))).toBeNull()
    expect(parseDiagramOutput(JSON.stringify({
      ok: true,
      format: 'arche-diagram/v1',
      diagram: {
        syntax: 'mermaid',
        title: 'Unsafe',
        source: 'flowchart TD\n  A[<b>Unsafe</b>] --> B',
      },
    }))).toBeNull()
  })
})

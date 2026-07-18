import { describe, expect, it } from 'vitest'

import {
  parseChartOutput,
  parseChartSpec,
} from '@/components/workspace/chat-panel/chart-output'
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
          params: [{ name: 'select', select: { type: 'point' } }],
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

describe('parseChartSpec', () => {
  it('parses a valid simple bar spec', () => {
    const result = parseChartSpec(chartSpec)
    expect(result).toEqual(chartSpec)
  })

  it('parses a valid line spec with extended marks', () => {
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ x: 1, y: 2 }] },
      mark: 'line',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
      },
    }
    expect(parseChartSpec(spec)).toEqual(spec)
  })

  it('parses extended mark types: rule, rect, text, tick, errorband, errorbar, circle, square, trail', () => {
    for (const mark of ['rule', 'rect', 'text', 'tick', 'errorband', 'errorbar', 'circle', 'square', 'trail']) {
      const spec = {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        data: { values: [{ x: 1, y: 2 }] },
        mark,
        encoding: {
          x: { field: 'x', type: 'quantitative' },
          y: { field: 'y', type: 'quantitative' },
        },
      }
      expect(parseChartSpec(spec)).toEqual(spec)
    }
  })

  it('parses a valid layered spec where each layer has a safe mark', () => {
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ x: 1, y: 2 }] },
      layer: [
        { mark: 'line', encoding: { x: { field: 'x', type: 'quantitative' }, y: { field: 'y', type: 'quantitative' } } },
        { mark: 'point', encoding: { x: { field: 'x', type: 'quantitative' }, y: { field: 'y', type: 'quantitative' } } },
      ],
    }
    expect(parseChartSpec(spec)).toEqual(spec)
  })

  it('parses a valid spec with transform', () => {
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ x: 1, y: 2 }] },
      transform: [{ calculate: 'datum.x + datum.y', as: 'z' }],
      mark: 'bar',
      encoding: {
        x: { field: 'x', type: 'nominal' },
        y: { field: 'y', type: 'quantitative' },
      },
    }
    expect(parseChartSpec(spec)).toEqual(spec)
  })

  it('parses a valid spec with resolve and spacing', () => {
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ x: 1, y: 2 }] },
      resolve: { scale: { y: 'independent' } },
      spacing: 20,
      mark: 'bar',
      encoding: {
        x: { field: 'x', type: 'nominal' },
        y: { field: 'y', type: 'quantitative' },
      },
    }
    expect(parseChartSpec(spec)).toEqual(spec)
  })

  it('rejects a non-record spec', () => {
    expect(parseChartSpec(null)).toBeNull()
    expect(parseChartSpec('not an object')).toBeNull()
    expect(parseChartSpec([1, 2, 3])).toBeNull()
  })

  it('rejects an unsupported top-level key', () => {
    expect(parseChartSpec({ ...chartSpec, description: 'a chart' })).toBeNull()
  })

  it('rejects spec with params (not in allowlist)', () => {
    expect(parseChartSpec({
      ...chartSpec,
      params: [{ name: 'select', select: { type: 'point' } }],
    })).toBeNull()
  })

  it('rejects a spec with a wrong $schema', () => {
    expect(parseChartSpec({ ...chartSpec, $schema: 'https://example.com/other.json' })).toBeNull()
  })

  it('rejects a spec with neither mark nor layer', () => {
    expect(parseChartSpec({
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ x: 1 }] },
      encoding: { x: { field: 'x', type: 'quantitative' } },
    })).toBeNull()
  })

  it('rejects a spec with an unsupported top-level mark', () => {
    expect(parseChartSpec({ ...chartSpec, mark: 'geoshape' })).toBeNull()
  })

  it('rejects a spec with a non-string top-level mark', () => {
    expect(parseChartSpec({ ...chartSpec, mark: { type: 'bar' } })).toBeNull()
  })

  it('rejects a layered spec with an unsupported mark in a layer', () => {
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ x: 1, y: 2 }] },
      layer: [
        { mark: 'line', encoding: {} },
        { mark: 'geoshape', encoding: {} },
      ],
    }
    expect(parseChartSpec(spec)).toBeNull()
  })

  it('rejects a layered spec where a layer has no mark', () => {
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ x: 1, y: 2 }] },
      layer: [
        { mark: 'line', encoding: {} },
        { encoding: {} },
      ],
    }
    expect(parseChartSpec(spec)).toBeNull()
  })

  it('rejects a layered spec with a non-array layer', () => {
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ x: 1, y: 2 }] },
      layer: { mark: 'line' },
    }
    expect(parseChartSpec(spec)).toBeNull()
  })

  it('rejects a layered spec with an empty layer array', () => {
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ x: 1, y: 2 }] },
      layer: [],
    }
    expect(parseChartSpec(spec)).toBeNull()
  })

  it('rejects a spec with a url key in a layer encoding', () => {
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ x: 1, y: 2 }] },
      layer: [
        {
          mark: 'bar',
          encoding: {
            x: { field: 'x', type: 'nominal' },
            y: { field: 'y', type: 'quantitative', url: 'https://example.com' },
          },
        },
      ],
    }
    expect(parseChartSpec(spec)).toBeNull()
  })

  it('rejects a spec with html in a string value', () => {
    expect(parseChartSpec({ ...chartSpec, title: '<b>Revenue</b>' })).toBeNull()
  })

  it('rejects a spec with a url in data values', () => {
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ href: 'https://example.com' }] },
      mark: 'bar',
      encoding: { x: { field: 'x', type: 'nominal' } },
    }
    expect(parseChartSpec(spec)).toBeNull()
  })

  it('rejects a spec with too many rows', () => {
    const values = Array.from({ length: 1001 }, (_, i) => ({ x: i, y: i }))
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values },
      mark: 'bar',
      encoding: { x: { field: 'x', type: 'quantitative' } },
    }
    expect(parseChartSpec(spec)).toBeNull()
  })

  it('rejects a spec with too many columns', () => {
    const row: Record<string, unknown> = {}
    for (let i = 0; i < 51; i++) row[`col${i}`] = i
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [row] },
      mark: 'bar',
      encoding: { x: { field: 'col0', type: 'quantitative' } },
    }
    expect(parseChartSpec(spec)).toBeNull()
  })

  it('rejects a spec with invalid width', () => {
    expect(parseChartSpec({ ...chartSpec, width: 5000 })).toBeNull()
  })

  it('rejects a spec with invalid autosize', () => {
    expect(parseChartSpec({ ...chartSpec, autosize: { type: 'invalid' } })).toBeNull()
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

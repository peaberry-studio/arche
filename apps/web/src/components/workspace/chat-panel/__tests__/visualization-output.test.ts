import { describe, expect, it } from 'vitest'

import { parseChartOutput } from '@/components/workspace/chat-panel/chart-output'
import { parseDiagramOutput } from '@/components/workspace/chat-panel/diagram-output'
import { VEGA_LITE_SCHEMA } from '@/lib/vega/sanitize-spec'

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
      chart: { title: 'Revenue', sourceNote: 'Forecast', spec: chartSpec },
    }))

    // parseChartOutput returns the canonical chart model so tool cards get the same
    // spec, warnings and row cost that markdown charts do.
    expect(result).toEqual({
      title: 'Revenue',
      sourceNote: 'Forecast',
      spec: { ...chartSpec, $schema: VEGA_LITE_SCHEMA },
      warnings: [],
      inlineRows: 1,
      dataUrls: [],
    })
  })

  it('rejects a malformed envelope', () => {
    expect(parseChartOutput('not-json')).toBeNull()
    expect(parseChartOutput(JSON.stringify({ ok: true, format: 'other', chart: {} }))).toBeNull()
    expect(parseChartOutput(JSON.stringify({ ok: true, format: 'arche-chart/v1' }))).toBeNull()
    expect(parseChartOutput(JSON.stringify({
      ok: true,
      format: 'arche-chart/v1',
      chart: { spec: chartSpec },
    }))).toBeNull()
  })

  it('accepts titles containing angle brackets (React escapes them on render)', () => {
    const result = parseChartOutput(JSON.stringify({
      ok: true,
      format: 'arche-chart/v1',
      chart: { title: 'p99 < 100ms', spec: chartSpec },
    }))

    expect(result?.title).toBe('p99 < 100ms')
  })

  it('rejects an over-long title or source note', () => {
    for (const chart of [
      { title: 'x'.repeat(161), spec: chartSpec },
      { title: 'Revenue', sourceNote: 'y'.repeat(301), spec: chartSpec },
    ]) {
      expect(parseChartOutput(JSON.stringify({ ok: true, format: 'arche-chart/v1', chart }))).toBeNull()
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

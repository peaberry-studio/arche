import { describe, expect, it } from 'vitest'

import { VEGA_LITE_SCHEMA, sanitizeVegaLiteSpec } from '@/lib/vega/sanitize-spec'

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

function sanitized(spec: unknown) {
  const result = sanitizeVegaLiteSpec(spec)
  if (!result) throw new Error('expected spec to be accepted')
  return result
}

/** Asserts the spec survives the sanitizer byte-for-byte, modulo the rewritten $schema. */
function expectPreserved(spec: Record<string, unknown>) {
  expect(sanitized(spec).spec).toEqual({ ...spec, $schema: VEGA_LITE_SCHEMA })
}

describe('sanitizeVegaLiteSpec: full grammar is preserved', () => {
  it('rewrites $schema to the shipped Vega-Lite version', () => {
    expect(sanitized(chartSpec).spec.$schema).toBe(VEGA_LITE_SCHEMA)
    expect(sanitized({ mark: 'bar' }).spec.$schema).toBe(VEGA_LITE_SCHEMA)
    expect(sanitized({ ...chartSpec, $schema: 'https://example.com/other.json' }).spec.$schema)
      .toBe(VEGA_LITE_SCHEMA)
  })

  it('preserves a simple spec unchanged', () => {
    expectPreserved(chartSpec)
    expect(sanitized(chartSpec).warnings).toEqual([])
  })

  it('preserves every top-level key the grammar defines', () => {
    expectPreserved({
      name: 'overview',
      description: 'A chart',
      usermeta: { arche: { figure: 1 } },
      background: 'white',
      padding: { left: 10, top: 5, right: 10, bottom: 5 },
      autosize: { type: 'fit', contains: 'padding', resize: true },
      config: { axis: { labelFontSize: 12 }, view: { stroke: null } },
      data: { values: [{ x: 1, y: 2 }] },
      datasets: { extra: [{ a: 1 }] },
      transform: [{ calculate: 'datum.x + 1', as: 'z' }],
      params: [{ name: 'grid', select: 'interval', bind: 'scales' }],
      width: 5000,
      height: 4000,
      view: { stroke: 'transparent' },
      mark: 'point',
      encoding: { x: { field: 'x', type: 'quantitative' } },
      resolve: { scale: { y: 'independent' } },
      title: { text: 'Figure 1 — Throughput', anchor: 'start' },
    })
  })

  it('preserves multi-view composition: layer, hconcat, vconcat, concat, facet, repeat', () => {
    const unit = { mark: 'bar', encoding: { x: { field: 'x', type: 'nominal' } } }

    expectPreserved({ data: { values: [{ x: 1 }] }, layer: [unit, { mark: 'line' }] })
    expectPreserved({ data: { values: [{ x: 1 }] }, hconcat: [unit, unit], spacing: 20 })
    expectPreserved({ data: { values: [{ x: 1 }] }, vconcat: [unit, unit], bounds: 'flush' })
    expectPreserved({ data: { values: [{ x: 1 }] }, concat: [unit, unit], columns: 2, center: true })
    expectPreserved({
      data: { values: [{ x: 1, g: 'a' }] },
      facet: { field: 'g', type: 'nominal', columns: 3 },
      spec: unit,
      align: 'each',
    })
    expectPreserved({
      data: { values: [{ a: 1, b: 2 }] },
      repeat: { column: ['a', 'b'] },
      spec: { mark: 'point', encoding: { x: { field: { repeat: 'column' }, type: 'quantitative' } } },
    })
  })

  it('preserves every mark type, including ones the old allowlist rejected', () => {
    for (const mark of [
      'arc', 'area', 'bar', 'circle', 'geoshape', 'image', 'line', 'point',
      'rect', 'rule', 'square', 'text', 'tick', 'trail',
      'boxplot', 'errorband', 'errorbar',
    ]) {
      expectPreserved({ data: { values: [{ x: 1 }] }, mark })
      expectPreserved({ data: { values: [{ x: 1 }] }, mark: { type: mark, tooltip: true } })
    }
  })

  it('preserves a spec with no mark and no layer', () => {
    expectPreserved({ data: { values: [{ x: 1 }] }, facet: { field: 'x' }, spec: { mark: 'bar' } })
  })

  it('preserves the full transform vocabulary', () => {
    expectPreserved({
      data: { values: [{ x: 1, y: 2, g: 'a' }] },
      transform: [
        { aggregate: [{ op: 'mean', field: 'y', as: 'my' }], groupby: ['g'] },
        { bin: true, field: 'x', as: 'bx' },
        { calculate: "datum.x > 1 ? 'hi' : 'lo'", as: 'band' },
        { density: 'x', bandwidth: 0.3 },
        { extent: 'x', param: 'x_extent' },
        { filter: 'datum.y != null && datum.x < 100' },
        { flatten: ['list'], as: ['item'] },
        { fold: ['x', 'y'], as: ['key', 'value'] },
        { impute: 'y', key: 'x', method: 'mean' },
        { joinaggregate: [{ op: 'sum', field: 'y', as: 'total' }] },
        { loess: 'y', on: 'x' },
        { lookup: 'g', from: { data: { values: [{ g: 'a', label: 'A' }] }, key: 'g', fields: ['label'] } },
        { pivot: 'g', value: 'y', groupby: ['x'] },
        { quantile: 'y', probs: [0.25, 0.5, 0.75] },
        { regression: 'y', on: 'x', method: 'poly', order: 2 },
        { sample: 500 },
        { stack: 'y', groupby: ['x'], as: ['y0', 'y1'] },
        { timeUnit: 'yearmonth', field: 'date', as: 'ym' },
        { window: [{ op: 'rank', as: 'r' }], sort: [{ field: 'y', order: 'descending' }] },
      ],
      mark: 'point',
    })
  })

  it('preserves params, selections and legend/input bindings', () => {
    expectPreserved({
      data: { values: [{ t: 0, config: 'A', v: 1 }] },
      params: [
        {
          name: 'visible_configurations',
          value: [{ config: 'A' }],
          select: { type: 'point', fields: ['config'], toggle: 'true' },
          bind: 'legend',
        },
        {
          name: 'visible_state',
          select: { type: 'point', fields: ['state'] },
          bind: { input: 'radio', options: [null, 'Running', 'Waiting'], name: 'Show state: ' },
        },
        { name: 'brush', select: { type: 'interval', encodings: ['x'] } },
        { name: 'cutoff', value: 50, bind: { input: 'range', min: 0, max: 100, step: 1 } },
      ],
      mark: 'line',
      encoding: {
        opacity: {
          condition: { param: 'visible_configurations', empty: false, value: 1 },
          value: 0,
        },
      },
    })
  })

  it('preserves top-level params (the layer[0] workaround is no longer needed)', () => {
    const spec = sanitized({
      data: { values: [{ x: 1 }] },
      params: [{ name: 'p', select: { type: 'point' }, bind: 'legend' }],
      mark: 'line',
    })
    expect(spec.spec.params).toEqual([{ name: 'p', select: { type: 'point' }, bind: 'legend' }])
  })

  it('preserves projections, geographic data and data generators', () => {
    expectPreserved({
      projection: { type: 'albersUsa', scale: 1000, translate: [480, 250] },
      layer: [
        { data: { graticule: { step: [10, 10] } }, mark: { type: 'geoshape', filled: false } },
        { data: { sequence: { start: 0, stop: 10, step: 1, as: 'x' } }, mark: 'point' },
        {
          data: { values: { type: 'FeatureCollection', features: [] }, format: { type: 'json' } },
          mark: 'geoshape',
        },
      ],
    })
  })

  it('preserves arbitrary text, including angle brackets and URLs', () => {
    // These render as SVG text nodes, never as HTML, so the old HTML/URL rejection
    // was blocking legitimate axis titles and annotations.
    expectPreserved({
      data: { values: [{ x: 1 }] },
      mark: 'text',
      title: 'Latency < 100ms (p99) — see https://example.com/runbook',
      encoding: {
        x: { field: 'x', type: 'quantitative', title: 'Throughput (tok/s) <steady state>' },
      },
    })
  })

  it('preserves expression strings verbatim', () => {
    expectPreserved({
      data: { values: [{ x: 1 }] },
      transform: [{ filter: "datum.x > 0 && indexof(['a','b'], datum.g) >= 0" }],
      mark: { type: 'rule' },
      encoding: { y: { value: { expr: 'height / 2' } } },
    })
  })
})

describe('sanitizeVegaLiteSpec: security transforms', () => {
  it('strips javascript: hrefs and reports a warning', () => {
    const result = sanitized({
      data: { values: [{ x: 1 }] },
      mark: 'point',
      encoding: { href: { value: 'javascript:alert(1)' } },
    })

    expect(result.spec).toEqual({
      $schema: VEGA_LITE_SCHEMA,
      data: { values: [{ x: 1 }] },
      mark: 'point',
      encoding: { href: {} },
    })
    expect(result.warnings).toContain('Removed a link with an unsupported URL scheme.')
  })

  it('strips hrefs obfuscated with control characters', () => {
    for (const href of ['java\nscript:alert(1)', '  JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script>']) {
      const result = sanitized({ mark: 'point', encoding: { href: { value: href } } })
      expect(result.spec.encoding).toEqual({ href: {} })
    }
  })

  it('leaves data-driven hrefs to the click-time guard rather than mangling the data', () => {
    // Rewriting rows here would corrupt legitimate data and still miss expression-built
    // hrefs. VegaFigure cancels navigation to an unsupported scheme instead.
    const values = [{ x: 1, href: 'javascript:alert(1)' }]
    const result = sanitized({
      data: { values },
      mark: 'point',
      encoding: { href: { field: 'href', type: 'nominal' } },
    })

    expect(result.spec.data).toEqual({ values })
  })

  it('preserves safe hrefs', () => {
    for (const href of ['https://example.com/a', 'http://example.com', 'mailto:a@b.co', '/kb/article', '#section', 'relative/path']) {
      const result = sanitized({ mark: 'point', encoding: { href: { value: href } } })
      expect(result.spec.encoding).toEqual({ href: { value: href } })
    }
  })

  it('strips loader overrides at any depth', () => {
    const result = sanitized({
      data: { values: [{ x: 1 }] },
      mark: 'point',
      config: { loader: { baseURL: 'https://evil.example.com' } },
    })

    expect(result.spec.config).toEqual({})
    expect(result.warnings).toContain('Removed a `loader` override; data loading is controlled by Arche.')
  })

  it('strips remote data urls but keeps relative ones and inline image data URIs', () => {
    const remote = sanitized({ data: { url: 'https://evil.example.com/x.csv' }, mark: 'point' })
    expect(remote.spec.data).toEqual({})
    expect(remote.warnings.some((w) => w.includes('Removed a remote `url`'))).toBe(true)

    expect(sanitized({ data: { url: 'data/latency.csv' }, mark: 'point' }).spec.data)
      .toEqual({ url: 'data/latency.csv' })

    const image = 'data:image/png;base64,iVBORw0KGgo='
    expect(sanitized({ mark: 'image', encoding: { url: { value: image } } }).spec.encoding)
      .toEqual({ url: { value: image } })

    expect(sanitized({ mark: 'image', encoding: { url: { value: 'data:text/html,<script>' } } }).spec.encoding)
      .toEqual({ url: {} })
  })
})

describe('sanitizeVegaLiteSpec: vega-embed option hijacking', () => {
  it('removes usermeta.embedOptions, which vega-embed merges over its caller options', () => {
    const result = sanitized({
      data: { values: [{ x: 1 }] },
      mark: 'point',
      usermeta: {
        arche: { figure: 1 },
        embedOptions: {
          actions: { editor: true },
          editorUrl: 'https://evil.example.com',
          ast: false,
          mode: 'vega',
        },
      },
    })

    expect(result.spec.usermeta).toEqual({ arche: { figure: 1 } })
    expect(JSON.stringify(result.spec)).not.toContain('evil.example.com')
    expect(result.warnings).toContain(
      'Removed `usermeta.embedOptions`; a chart cannot change how Arche embeds it.',
    )
  })

  it('leaves other usermeta untouched', () => {
    const result = sanitized({ mark: 'point', usermeta: { notes: 'kept', nested: { a: 1 } } })
    expect(result.spec.usermeta).toEqual({ notes: 'kept', nested: { a: 1 } })
    expect(result.warnings).toEqual([])
  })
})

describe('sanitizeVegaLiteSpec: inline data is opaque', () => {
  it('leaves data row columns named url or href alone', () => {
    // A `url` column rendered as a text label is data, not a resource reference.
    const values = [{ label: 'a', url: 'https://example.com/report', href: 'https://example.com/x' }]
    const result = sanitized({ data: { values }, mark: 'text', encoding: { text: { field: 'url' } } })

    expect(result.spec.data).toEqual({ values })
    expect(result.warnings).toEqual([])
  })

  it('still strips unsafe literals declared in the href channel', () => {
    const result = sanitized({
      data: { values: [{ x: 1 }] },
      mark: 'point',
      encoding: { href: { value: 'javascript:alert(1)' } },
    })

    expect(result.spec.encoding).toEqual({ href: {} })
  })

  it('keeps a field reference in an href channel intact', () => {
    const result = sanitized({
      data: { values: [{ href: 'https://example.com' }] },
      mark: 'point',
      encoding: { href: { field: 'href', type: 'nominal', title: 'Link' } },
    })

    expect(result.spec.encoding).toEqual({ href: { field: 'href', type: 'nominal', title: 'Link' } })
  })
})

describe('sanitizeVegaLiteSpec: data.url collection matches the URL policy', () => {
  it('does not collect an obfuscated inline image as a workspace path', () => {
    // Policy normalizes this to `data:` and keeps it as a safe inline image, so collection
    // must reach the same conclusion or PDF export would look for a file by that name.
    const chart = sanitized({ data: { url: 'da\tta:image/png;base64,AA' }, mark: 'bar' })
    expect(chart.dataUrls).toEqual([])
  })
})

describe('sanitizeVegaLiteSpec: resource budgets', () => {
  it('rejects values that are not objects', () => {
    expect(sanitizeVegaLiteSpec(null)).toBeNull()
    expect(sanitizeVegaLiteSpec('not an object')).toBeNull()
    expect(sanitizeVegaLiteSpec([1, 2, 3])).toBeNull()
  })

  it('accepts a structurally invalid spec and defers the error to Vega-Lite', () => {
    // Correctness is Vega-Lite's job; its compile errors are more useful to an agent
    // than a null from us, so the sanitizer only enforces security and resource limits.
    expect(sanitizeVegaLiteSpec({})).not.toBeNull()
    expect(sanitizeVegaLiteSpec({ mark: 'not-a-real-mark' })).not.toBeNull()
  })

  it('tracks the repeat product per path, not globally', () => {
    // Two sibling 15x15 repeats are 225 views each — fine. A global accumulator would
    // wrongly reject them at 450; only nesting multiplies.
    const fields = Array.from({ length: 15 }, (_, i) => `f${i}`)
    const repeated = {
      repeat: { row: fields, column: fields },
      spec: { mark: 'point', encoding: { x: { field: { repeat: 'column' }, type: 'quantitative' } } },
    }

    expect(sanitizeVegaLiteSpec({
      data: { values: [{ f0: 1 }] },
      hconcat: [repeated, repeated],
    })).not.toBeNull()
  })

  it('compounds nested repeat products along a path', () => {
    // 5 outer x 100 inner = 500 views > 400, even though each level alone is under budget.
    const outer = Array.from({ length: 5 }, (_, i) => `o${i}`)
    const inner = Array.from({ length: 100 }, (_, i) => `i${i}`)

    expect(sanitizeVegaLiteSpec({
      data: { values: [{ o0: 1 }] },
      repeat: { row: outer },
      spec: {
        repeat: { column: inner },
        spec: { mark: 'point' },
      },
    })).toBeNull()
  })

  it('rejects deep nesting without throwing, at every depth', () => {
    // The complexity preflight runs before the sanitizing walk and recurses too. If only
    // the walk carries a depth budget there is a band of depths — past the JS stack but
    // within what JSON.stringify survives — where the preflight throws RangeError instead
    // of rejecting, and the throw escapes into the caller's render.
    for (const depth of [100, 1_000, 5_000, 20_000]) {
      let deep: Record<string, unknown> = { mark: 'bar' }
      for (let i = 0; i < depth; i += 1) deep = { spec: deep }

      expect(() => sanitizeVegaLiteSpec(deep), `depth ${depth}`).not.toThrow()
      expect(sanitizeVegaLiteSpec(deep), `depth ${depth}`).toBeNull()
    }
  })

  it('rejects a spec nested past the depth budget', () => {
    let deep: Record<string, unknown> = { mark: 'bar' }
    for (let i = 0; i < 70; i += 1) deep = { nested: deep }

    expect(sanitizeVegaLiteSpec(deep)).toBeNull()
  })

  it('rejects a spec past the total row budget', () => {
    const values = Array.from({ length: 200_001 }, (_, i) => ({ x: i }))
    expect(sanitizeVegaLiteSpec({ data: { values }, mark: 'point' })).toBeNull()
  })

  it('counts named datasets toward the row budget', () => {
    const values = Array.from({ length: 200_001 }, (_, i) => ({ x: i }))
    expect(sanitizeVegaLiteSpec({
      datasets: { series: values },
      data: { name: 'series' },
      mark: 'point',
    })).toBeNull()
  })

  it('counts GeoJSON features toward the row budget', () => {
    const features = Array.from({ length: 200_001 }, () => ({ type: 'Feature' }))
    expect(sanitizeVegaLiteSpec({
      data: { values: { type: 'FeatureCollection', features } },
      mark: 'geoshape',
    })).toBeNull()
  })

  it('counts generated sequence rows toward the row budget', () => {
    expect(sanitizeVegaLiteSpec({
      data: { sequence: { start: 0, stop: 5_000_000, step: 1 } },
      mark: 'line',
    })).toBeNull()

    const ok = sanitized({ data: { sequence: { start: 0, stop: 100, step: 1 } }, mark: 'line' })
    expect(ok.inlineRows).toBe(100)
  })

  it('sums rows across every inline source', () => {
    const result = sanitized({
      data: { values: [{ x: 1 }, { x: 2 }] },
      datasets: { extra: [{ y: 1 }, { y: 2 }, { y: 3 }] },
      mark: 'point',
    })

    expect(result.inlineRows).toBe(5)
  })

  it('accepts row counts far above the old 1000-row limit', () => {
    const values = Array.from({ length: 50_000 }, (_, i) => ({ x: i, y: i * 2 }))
    const result = sanitized({ data: { values }, mark: 'line' })
    expect((result.spec.data as { values: unknown[] }).values).toHaveLength(50_000)
  })

  it('accepts column counts above the old 50-column limit', () => {
    const row: Record<string, number> = {}
    for (let i = 0; i < 120; i += 1) row[`col${i}`] = i
    expect(sanitizeVegaLiteSpec({ data: { values: [row] }, mark: 'bar' })).not.toBeNull()
  })

  it('bounds repeat view multiplication', () => {
    const fields = Array.from({ length: 21 }, (_, i) => `f${i}`)
    const unit = {
      mark: 'point',
      encoding: { x: { field: { repeat: 'column' }, type: 'quantitative' } },
    }

    expect(sanitizeVegaLiteSpec({
      repeat: { row: fields, column: fields },
      spec: unit,
    })).toBeNull()
    expect(sanitizeVegaLiteSpec({
      repeat: { row: fields.slice(0, 20), column: fields.slice(0, 20) },
      spec: unit,
    })).not.toBeNull()
  })

  it('bounds dimensions and generated graticules', () => {
    expect(sanitizeVegaLiteSpec({ width: 10_001, mark: 'point' })).toBeNull()
    expect(sanitizeVegaLiteSpec({
      data: { graticule: { stepMinor: [0.01, 0.01] } },
      mark: 'geoshape',
    })).toBeNull()
  })
})

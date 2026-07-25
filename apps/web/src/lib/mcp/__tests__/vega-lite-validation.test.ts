import { describe, expect, it } from 'vitest'

import { validateVegaLiteSpec } from '@/lib/mcp/vega-lite-validation'

const encoding = {
  x: { field: 'x', type: 'quantitative' },
  y: { field: 'y', type: 'quantitative' },
}

describe('validateVegaLiteSpec', () => {
  it('accepts every feature family the old allowlist rejected', async () => {
    const specs: Record<string, unknown>[] = [
      { data: { values: [{ x: 1, y: 2 }] }, mark: 'point', encoding },
      { data: { values: [{ x: 1, y: 2 }] }, hconcat: [{ mark: 'bar', encoding }, { mark: 'line', encoding }] },
      { data: { values: [{ x: 1, y: 2 }] }, vconcat: [{ mark: 'bar', encoding }] },
      { data: { values: [{ x: 1, y: 2 }] }, concat: [{ mark: 'bar', encoding }], columns: 2 },
      {
        data: { values: [{ x: 1, y: 2, g: 'a' }] },
        facet: { field: 'g', type: 'nominal' },
        spec: { mark: 'bar', encoding },
      },
      {
        data: { values: [{ a: 1, b: 2 }] },
        repeat: { column: ['a', 'b'] },
        spec: { mark: 'point', encoding: { x: { field: { repeat: 'column' }, type: 'quantitative' } } },
      },
      {
        data: { values: [{ x: 1, y: 2, g: 'a' }] },
        mark: 'line',
        encoding,
        params: [{ name: 'sel', select: { type: 'point', fields: ['g'] }, bind: 'legend' }],
      },
      { data: { values: [{ x: 1, y: 2 }] }, mark: 'boxplot', encoding },
      { data: { values: [{ x: 1, y: 2 }] }, mark: 'errorband', encoding },
      {
        data: { values: [{ x: 1, y: 2 }] },
        mark: 'point',
        encoding,
        transform: [
          { calculate: 'datum.x * 2', as: 'double' },
          { regression: 'y', on: 'x' },
          { window: [{ op: 'rank', as: 'r' }] },
        ],
      },
    ]

    for (const spec of specs) {
      const result = await validateVegaLiteSpec(JSON.stringify(spec))
      expect(result.ok, `${JSON.stringify(spec).slice(0, 80)} → ${JSON.stringify(result)}`).toBe(true)
    }
  })

  it('reports invalid JSON', async () => {
    const result = await validateVegaLiteSpec('{ not json')
    expect(result).toMatchObject({ ok: false, error: 'invalid_json' })
  })

  it('reports a compile error with Vega-Lite own message', async () => {
    const result = await validateVegaLiteSpec(JSON.stringify({ data: { values: [{ x: 1 }] } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('compile_error')
    expect(result.message).toMatch(/Invalid specification/i)
    expect(result.hint).toContain('vega-lite/docs')
  })

  it('rejects specs past the resource budget', async () => {
    const values = Array.from({ length: 200_001 }, (_, i) => ({ x: i }))
    const result = await validateVegaLiteSpec(JSON.stringify({ data: { values }, mark: 'point' }))
    expect(result).toMatchObject({ ok: false, error: 'rejected' })
  })

  it('reports what the security pass stripped', async () => {
    const result = await validateVegaLiteSpec(JSON.stringify({
      data: { values: [{ x: 1, y: 2 }] },
      mark: 'point',
      encoding: { ...encoding, href: { value: 'javascript:alert(1)' } },
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toContain('Removed a link with an unsupported URL scheme.')
  })

  it('reports the inline row count', async () => {
    const result = await validateVegaLiteSpec(JSON.stringify({
      data: { values: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] },
      mark: 'line',
      encoding,
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inlineRows).toBe(3)
  })
})

/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VEGA_LITE_SCHEMA } from '@/lib/vega/sanitize-spec'
import { MarkdownChart } from '@/components/workspace/markdown-chart'

const embedMock = vi.hoisted(() => vi.fn(async (...[element]: [HTMLElement, unknown, Record<string, unknown>]) => {
  element.innerHTML = '<svg><text>chart rendered</text></svg>'
  return { finalize: vi.fn() }
}))

const vegaStub = vi.hoisted(() => ({
  loader: () => ({ sanitize: async (uri: string) => ({ href: String(uri) }) }),
}))

vi.mock('vega-embed', () => ({ default: embedMock, vega: vegaStub }))

const validSpec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  data: { values: [{ quarter: 'Q1', revenue: 10 }] },
  mark: 'bar',
  encoding: {
    x: { field: 'quarter', type: 'nominal' },
    y: { field: 'revenue', type: 'quantitative' },
  },
}

const validLayeredSpec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  data: { values: [{ x: 1, y: 2 }] },
  layer: [
    { mark: 'line', encoding: { x: { field: 'x', type: 'quantitative' }, y: { field: 'y', type: 'quantitative' } } },
    { mark: 'point', encoding: { x: { field: 'x', type: 'quantitative' }, y: { field: 'y', type: 'quantitative' } } },
  ],
}

describe('MarkdownChart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders a chart for a valid vega-lite spec', async () => {
    render(<MarkdownChart source={JSON.stringify(validSpec)} />)

    await waitFor(() => expect(embedMock).toHaveBeenCalledTimes(1))
    const [element, spec] = embedMock.mock.calls[0]!
    expect(element).toBeInstanceOf(HTMLElement)
    expect(spec).toMatchObject({
      $schema: VEGA_LITE_SCHEMA,
      mark: 'bar',
    })
    expect(screen.getByText('chart rendered')).toBeTruthy()
  })

  it('renders a chart for a valid layered vega-lite spec', async () => {
    render(<MarkdownChart source={JSON.stringify(validLayeredSpec)} />)

    await waitFor(() => expect(embedMock).toHaveBeenCalledTimes(1))
    const spec = embedMock.mock.calls[0]?.[1]
    expect(spec).toMatchObject({
      layer: [
        { mark: 'line' },
        { mark: 'point' },
      ],
    })
  })

  it('trims a trailing newline before parsing', async () => {
    render(<MarkdownChart source={`${JSON.stringify(validSpec)}\n`} />)

    await waitFor(() => expect(embedMock).toHaveBeenCalledTimes(1))
  })

  it('renders a fallback when source is not valid JSON', () => {
    render(<MarkdownChart source="not json" />)

    expect(embedMock).not.toHaveBeenCalled()
    const pre = document.querySelector('pre')
    expect(pre).toBeTruthy()
    expect(pre?.textContent).toContain('not json')
    expect(screen.getByText('Unable to render chart. The spec is still available above.')).toBeTruthy()
  })

  it('renders marks the old allowlist rejected', async () => {
    render(<MarkdownChart source={JSON.stringify({ ...validSpec, mark: 'geoshape' })} />)

    await waitFor(() => expect(embedMock).toHaveBeenCalledTimes(1))
    expect(embedMock.mock.calls[0]?.[1]).toMatchObject({ mark: 'geoshape' })
    expect(document.querySelector('pre')).toBeNull()
  })

  it('renders multi-view specs', async () => {
    const concatSpec = {
      data: { values: [{ x: 1 }] },
      hconcat: [{ mark: 'bar' }, { mark: 'line' }],
    }
    render(<MarkdownChart source={JSON.stringify(concatSpec)} />)

    await waitFor(() => expect(embedMock).toHaveBeenCalledTimes(1))
    expect(embedMock.mock.calls[0]?.[1]).toMatchObject({
      hconcat: [{ mark: 'bar' }, { mark: 'line' }],
    })
  })

  it('renders the chart but reports what it stripped from an unsafe spec', async () => {
    const unsafeSpec = {
      ...validSpec,
      encoding: { ...validSpec.encoding, href: { value: 'javascript:alert(1)' } },
    }
    render(<MarkdownChart source={JSON.stringify(unsafeSpec)} />)

    await waitFor(() => expect(embedMock).toHaveBeenCalledTimes(1))
    const spec = embedMock.mock.calls[0]?.[1] as { encoding: Record<string, unknown> }
    expect(spec.encoding.href).toEqual({})
    expect(screen.getByText('Removed a link with an unsupported URL scheme.')).toBeTruthy()
  })

  it('withholds the error note while a spec is still streaming in', () => {
    render(<MarkdownChart source='{"$schema": "https://vega.github.io/schema/vega-lite/v6.json", "mark": "ba' />)

    expect(embedMock).not.toHaveBeenCalled()
    expect(document.querySelector('pre')).toBeTruthy()
    expect(screen.queryByText('Unable to render chart. The spec is still available above.')).toBeNull()
  })

  it('renders a fallback for an empty source', () => {
    render(<MarkdownChart source="" />)

    expect(embedMock).not.toHaveBeenCalled()
    expect(document.querySelector('pre')).toBeTruthy()
  })
})

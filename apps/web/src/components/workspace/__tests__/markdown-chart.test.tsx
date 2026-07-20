/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MarkdownChart } from '@/components/workspace/markdown-chart'

const embedMock = vi.hoisted(() => vi.fn(async (...[element]: [HTMLElement, unknown, Record<string, unknown>]) => {
  element.innerHTML = '<svg><text>chart rendered</text></svg>'
  return { finalize: vi.fn() }
}))

vi.mock('vega-embed', () => ({ default: embedMock }))

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
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
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

  it('renders a fallback when source is an unsafe spec', () => {
    const unsafeSpec = {
      ...validSpec,
      data: { values: [{ href: 'https://example.com' }] },
    }
    render(<MarkdownChart source={JSON.stringify(unsafeSpec)} />)

    expect(embedMock).not.toHaveBeenCalled()
    const pre = document.querySelector('pre')
    expect(pre).toBeTruthy()
    expect(screen.getByText('Unable to render chart. The spec is still available above.')).toBeTruthy()
  })

  it('renders a fallback when source has an unsupported mark', () => {
    const unsafeSpec = { ...validSpec, mark: 'geoshape' }
    render(<MarkdownChart source={JSON.stringify(unsafeSpec)} />)

    expect(embedMock).not.toHaveBeenCalled()
    expect(document.querySelector('pre')).toBeTruthy()
  })

  it('renders a fallback for an empty source', () => {
    render(<MarkdownChart source="" />)

    expect(embedMock).not.toHaveBeenCalled()
    expect(document.querySelector('pre')).toBeTruthy()
  })
})

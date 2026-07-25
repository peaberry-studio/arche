/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VegaFigure } from '@/components/workspace/vega-figure'
import type { SanitizedChart } from '@/lib/vega/sanitize-spec'

const embedMock = vi.hoisted(() =>
  vi.fn(async (...[element]: [HTMLElement, unknown, Record<string, unknown>]) => {
    element.innerHTML = '<svg><a href="javascript:alert(1)"><text>unsafe</text></a>' +
      '<a href="https://example.com/ok"><text>safe</text></a></svg>'
    return { finalize: vi.fn() }
  }),
)

const defaultSanitize = vi.hoisted(() => vi.fn(async (uri: string) => ({ href: `default:${uri}` })))

const vegaStub = vi.hoisted(() => ({
  loader: () => ({ sanitize: defaultSanitize }),
}))

vi.mock('vega-embed', () => ({ default: embedMock, vega: vegaStub }))

const spec = { $schema: 'https://vega.github.io/schema/vega-lite/v6.json', mark: 'bar' }

/** VegaFigure takes the whole sanitized model, so tests build one rather than props. */
function chartOf(overrides: Partial<SanitizedChart> = {}): SanitizedChart {
  return { spec, warnings: [], inlineRows: 0, dataUrls: [], ...overrides }
}

describe('VegaFigure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders warnings above the chart', async () => {
    render(<VegaFigure chart={chartOf({ warnings: ['Removed a `loader` override.'] })} />)

    await waitFor(() => expect(embedMock).toHaveBeenCalled())
    expect(screen.getByText('Removed a `loader` override.')).toBeTruthy()
  })

  it('switches to the canvas renderer for large inline datasets', async () => {
    render(<VegaFigure chart={chartOf({ inlineRows: 50_000 })} />)

    await waitFor(() => expect(embedMock).toHaveBeenCalled())
    expect(embedMock.mock.calls[0]?.[2]).toMatchObject({ renderer: 'canvas' })
  })

  it('keeps the SVG renderer for ordinary datasets', async () => {
    render(<VegaFigure chart={chartOf({ inlineRows: 100 })} />)

    await waitFor(() => expect(embedMock).toHaveBeenCalled())
    expect(embedMock.mock.calls[0]?.[2]).toMatchObject({ renderer: 'svg' })
  })

  it('passes no loader when there is no workspace', async () => {
    render(<VegaFigure chart={chartOf()} />)

    await waitFor(() => expect(embedMock).toHaveBeenCalled())
    expect(embedMock.mock.calls[0]?.[2]?.loader).toBeUndefined()
  })

  it('resolves relative data URLs against the workspace file route', async () => {
    render(<VegaFigure chart={chartOf()} workspaceSlug="my-space" />)

    await waitFor(() => expect(embedMock).toHaveBeenCalled())
    const loader = embedMock.mock.calls[0]?.[2]?.loader as {
      sanitize: (uri: string, options: unknown) => Promise<{ href: string }>
    }

    expect(await loader.sanitize('data/latency.csv', {})).toEqual({
      href: '/api/w/my-space/files/download?path=data%2Flatency.csv',
    })
  })

  it('refuses data URLs that climb out of the workspace', async () => {
    render(<VegaFigure chart={chartOf()} workspaceSlug="my-space" />)

    await waitFor(() => expect(embedMock).toHaveBeenCalled())
    const loader = embedMock.mock.calls[0]?.[2]?.loader as {
      sanitize: (uri: string, options: unknown) => Promise<{ href: string }>
    }

    await expect(loader.sanitize('../../etc/passwd', {})).rejects.toThrow(/escapes the workspace/)
  })

  it('leaves absolute URIs to Vega default handling', async () => {
    render(<VegaFigure chart={chartOf()} workspaceSlug="my-space" />)

    await waitFor(() => expect(embedMock).toHaveBeenCalled())
    const loader = embedMock.mock.calls[0]?.[2]?.loader as {
      sanitize: (uri: string, options: unknown) => Promise<{ href: string }>
    }

    expect(await loader.sanitize('data:image/png;base64,AA', {})).toEqual({
      href: 'default:data:image/png;base64,AA',
    })
  })

  it('blocks clicks on links with an unsupported scheme but allows safe ones', async () => {
    render(<VegaFigure chart={chartOf()} />)
    await waitFor(() => expect(embedMock).toHaveBeenCalled())

    const unsafe = document.querySelector('a[href^="javascript"]')
    const safe = document.querySelector('a[href^="https"]')
    expect(unsafe).toBeTruthy()
    expect(safe).toBeTruthy()

    // fireEvent.click returns false when a handler called preventDefault.
    expect(fireEvent.click(unsafe as Element)).toBe(false)
    expect(fireEvent.click(safe as Element)).toBe(true)
  })

  it('surfaces the underlying Vega-Lite error message', async () => {
    embedMock.mockRejectedValueOnce(new Error('Invalid specification. Make sure it includes a mark.'))
    render(<VegaFigure chart={chartOf()} />)

    await waitFor(() =>
      expect(screen.getByText('Invalid specification. Make sure it includes a mark.')).toBeTruthy(),
    )
    expect(screen.getByText('Unable to render chart.')).toBeTruthy()
  })
})

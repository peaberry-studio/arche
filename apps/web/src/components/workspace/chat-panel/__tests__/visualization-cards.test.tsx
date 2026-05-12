/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChartCard } from '@/components/workspace/chat-panel/chart-card'
import type { ChartOutput } from '@/components/workspace/chat-panel/chart-output'
import { DiagramCard } from '@/components/workspace/chat-panel/diagram-card'
import type { DiagramOutput } from '@/components/workspace/chat-panel/diagram-output'

const embedMock = vi.hoisted(() => vi.fn(async (...[element]: [HTMLElement, unknown, Record<string, unknown>]) => {
  element.innerHTML = '<svg><text>chart rendered</text></svg>'
  return { finalize: vi.fn() }
}))
const mermaidInitializeMock = vi.hoisted(() => vi.fn())
const mermaidRenderMock = vi.hoisted(() => vi.fn(async () => ({
  svg: '<svg><text>diagram rendered</text></svg>',
})))
const sanitizeMock = vi.hoisted(() => vi.fn((svg: string) => svg))

vi.mock('vega-embed', () => ({ default: embedMock }))
vi.mock('mermaid', () => ({
  default: {
    initialize: mermaidInitializeMock,
    render: mermaidRenderMock,
  },
}))
vi.mock('dompurify', () => ({ default: { sanitize: sanitizeMock } }))

const chart: ChartOutput = {
  title: 'Revenue',
  sourceNote: 'Forecast',
  spec: {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    data: { values: [{ quarter: 'Q1', revenue: 10 }] },
    mark: 'bar',
    encoding: {
      x: { field: 'quarter', type: 'nominal' },
      y: { field: 'revenue', type: 'quantitative' },
    },
  },
}

const diagram: DiagramOutput = {
  syntax: 'mermaid',
  title: 'Support flow',
  source: 'graph TD\n  A --> B',
}

describe('visualization cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders charts with CSP-safe Vega options and copies the spec', async () => {
    render(<ChartCard chart={chart} isRunning={false} />)

    expect(screen.getByText('Revenue')).toBeTruthy()
    expect(screen.getByText('Forecast')).toBeTruthy()

    await waitFor(() => expect(embedMock).toHaveBeenCalled())
    const embedOptions = embedMock.mock.calls[0]?.[2]
    expect(embedOptions).toMatchObject({
      actions: false,
      ast: true,
      defaultStyle: false,
      mode: 'vega-lite',
      renderer: 'svg',
      tooltip: false,
    })
    expect(embedOptions?.config).toMatchObject({
      background: 'transparent',
      axis: expect.objectContaining({ gridColor: expect.any(String) }),
      range: expect.objectContaining({ category: expect.any(Array) }),
    })
    expect(screen.getByText('chart rendered')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Copy chart spec'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"mark": "bar"')))
  })

  it('renders Mermaid diagrams with strict settings and sanitized SVG', async () => {
    const { rerender } = render(<DiagramCard diagram={diagram} isRunning={false} />)

    expect(screen.getByText('Support flow')).toBeTruthy()

    await waitFor(() => expect(mermaidInitializeMock).toHaveBeenCalledTimes(1))
    expect(mermaidInitializeMock).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: 'strict',
      suppressErrorRendering: true,
      htmlLabels: false,
      flowchart: expect.objectContaining({ useMaxWidth: true }),
      theme: 'base',
      themeVariables: expect.objectContaining({
        primaryColor: expect.any(String),
        lineColor: expect.any(String),
        nodeTextColor: expect.any(String),
      }),
    }))
    expect(sanitizeMock).toHaveBeenCalledWith('<svg><text>diagram rendered</text></svg>', {
      USE_PROFILES: { svg: true, svgFilters: true },
    })
    expect(screen.getByText('diagram rendered')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Copy diagram source'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(diagram.source))

    rerender(<DiagramCard diagram={{ ...diagram, source: 'graph TD\n  A --> C' }} isRunning={false} />)
    await waitFor(() => expect(mermaidRenderMock).toHaveBeenCalledTimes(2))
    expect(mermaidInitializeMock).toHaveBeenCalledTimes(1)
  })

  it('logs render failures while showing safe error copy', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    embedMock.mockRejectedValueOnce(new Error('bad chart'))
    mermaidRenderMock.mockRejectedValueOnce(new Error('bad diagram'))

    render(
      <>
        <ChartCard chart={chart} isRunning={false} />
        <DiagramCard diagram={diagram} isRunning={false} />
      </>,
    )

    expect(await screen.findByText('Unable to render chart. The chart spec is still available to copy.')).toBeTruthy()
    expect(await screen.findByText('Unable to render diagram. The Mermaid source is still available to copy.')).toBeTruthy()
    expect(consoleError).toHaveBeenCalledWith('Failed to render chart:', expect.any(Error))
    expect(consoleError).toHaveBeenCalledWith('Failed to render diagram:', expect.any(Error))
    consoleError.mockRestore()
  })
})

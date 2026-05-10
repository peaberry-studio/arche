/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChartCard } from '@/components/workspace/chat-panel/chart-card'
import type { ChartOutput } from '@/components/workspace/chat-panel/chart-output'
import { DiagramCard } from '@/components/workspace/chat-panel/diagram-card'
import type { DiagramOutput } from '@/components/workspace/chat-panel/diagram-output'

const embedMock = vi.hoisted(() => vi.fn(async (element: HTMLElement) => {
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
  source: 'flowchart TD\n  A --> B',
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

    expect(screen.getByText('Chart')).toBeTruthy()
    expect(screen.getByText('Revenue')).toBeTruthy()
    expect(screen.getByText('Forecast')).toBeTruthy()

    await waitFor(() => expect(embedMock).toHaveBeenCalled())
    expect(embedMock.mock.calls[0]?.[2]).toMatchObject({
      actions: false,
      ast: true,
      defaultStyle: false,
      mode: 'vega-lite',
      renderer: 'svg',
      tooltip: false,
    })
    expect(screen.getByText('chart rendered')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Copy chart spec'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"mark": "bar"')))
  })

  it('renders Mermaid diagrams with strict settings and sanitized SVG', async () => {
    render(<DiagramCard diagram={diagram} isRunning={false} />)

    expect(screen.getByText('Diagram')).toBeTruthy()
    expect(screen.getByText('Support flow')).toBeTruthy()

    await waitFor(() => expect(mermaidInitializeMock).toHaveBeenCalled())
    expect(mermaidInitializeMock).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: 'strict',
      flowchart: { htmlLabels: false },
    }))
    expect(sanitizeMock).toHaveBeenCalledWith('<svg><text>diagram rendered</text></svg>', {
      USE_PROFILES: { svg: true, svgFilters: true },
    })
    expect(screen.getByText('diagram rendered')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Copy diagram source'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(diagram.source))
  })
})

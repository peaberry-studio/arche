/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolGroup, type ToolPart } from '@/components/workspace/chat-panel/message-part-renderer'
import { createDefaultFlowDefinition } from '@/lib/flows/validation'

vi.mock('vega-embed', () => ({ default: vi.fn(async () => ({ finalize: vi.fn() })) }))
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg></svg>' })),
  },
}))

function renderTool(tool: string, input: Record<string, unknown> = {}, output?: string) {
  const part: ToolPart = {
    type: 'tool',
    id: 'tool-1',
    name: tool,
    state: output === undefined
      ? { status: 'running', input }
      : { status: 'completed', input, output, title: '' },
  }

  return render(<ToolGroup tool={tool} parts={[part]} sessionTabs={[]} slug="alice" />)
}

describe.each(['', 'arche_tools_'])('ToolGroup with %s tool names', (prefix) => {
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

  it.each([
    ['chart_create', 'Creating chart'],
    ['diagram_create', 'Creating diagram'],
    ['document_inspect', 'Document inspect'],
    ['email_draft', 'Drafting email'],
    ['flow_propose', 'Proposing flow'],
    ['learning_propose', 'Proposing KB learning'],
    ['presentation_inspect', 'Presentation inspect'],
    ['session_history_query', 'Querying session history'],
    ['spreadsheet_inspect', 'Spreadsheet inspect'],
    ['spreadsheet_query', 'Spreadsheet query'],
    ['spreadsheet_sample', 'Spreadsheet sample'],
    ['spreadsheet_stats', 'Spreadsheet stats'],
  ])('preserves the label for %s', (tool, label) => {
    renderTool(`${prefix}${tool}`)

    expect(screen.getByText(label)).toBeTruthy()
  })

  it.each([
    { tool: 'chart_create', input: { title: 'Revenue', type: 'bar' }, summary: 'Revenue · bar' },
    { tool: 'diagram_create', input: { title: 'Support flow' }, summary: 'Support flow' },
    { tool: 'flow_propose', input: { name: 'Weekly review' }, summary: 'Weekly review' },
  ])('preserves input summaries for $tool', ({ tool, input, summary }) => {
    renderTool(`${prefix}${tool}`, input)

    expect(screen.getByText(summary)).toBeTruthy()
  })

  it('renders a copyable email draft', async () => {
    renderTool(`${prefix}email_draft`, {}, JSON.stringify({
      subject: 'Quarterly update',
      body: 'Revenue increased.',
      to: ['ana@example.com'],
    }))

    expect(screen.getByText('Email draft')).toBeTruthy()
    expect(screen.getByText('ana@example.com')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Copy email draft'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Subject: Quarterly update'),
    ))
  })

  it('renders a chart with its spec attachment', async () => {
    renderTool(`${prefix}chart_create`, {}, JSON.stringify({
      ok: true,
      format: 'arche-chart/v1',
      chart: {
        title: 'Revenue',
        spec: {
          $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
          mark: 'bar',
          data: { values: [{ quarter: 'Q1', revenue: 10 }] },
          encoding: {
            x: { field: 'quarter', type: 'nominal' },
            y: { field: 'revenue', type: 'quantitative' },
          },
        },
      },
    }))

    expect(screen.getByText('Revenue')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Copy chart spec'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"mark": "bar"'),
    ))
  })

  it('renders a diagram with its source attachment', async () => {
    renderTool(`${prefix}diagram_create`, {}, JSON.stringify({
      ok: true,
      format: 'arche-diagram/v1',
      diagram: { syntax: 'mermaid', title: 'Support flow', source: 'graph TD\n  A --> B' },
    }))

    expect(screen.getByText('Support flow')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Copy diagram source'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('graph TD\n  A --> B'))
  })

  it('renders a reviewable flow template attachment', () => {
    renderTool(`${prefix}flow_propose`, {}, JSON.stringify({
      ok: true,
      format: 'arche-flow-template/v1',
      template: {
        format: 'arche-flow-template/v1',
        name: 'Weekly review',
        enabled: false,
        timezone: 'UTC',
        cronExpression: null,
        definition: createDefaultFlowDefinition(),
      },
    }))

    expect(screen.getByText('Flow proposal')).toBeTruthy()
    expect(screen.getByText('Weekly review')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Review & create' })).toBeTruthy()
  })

  it.each([
    ['email_draft', 'Drafting email'],
    ['chart_create', 'Creating chart'],
    ['diagram_create', 'Creating diagram'],
    ['flow_propose', 'Proposing flow'],
  ])('keeps invalid %s outputs in the normal tool display', (tool, label) => {
    renderTool(`${prefix}${tool}`, {}, '{"ok":false}')

    expect(screen.getByText(label)).toBeTruthy()
    expect(screen.queryByLabelText(/Copy/)).toBeNull()
  })
})

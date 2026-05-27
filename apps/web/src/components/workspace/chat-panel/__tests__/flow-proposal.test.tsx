/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FlowProposalCard, parseFlowProposalOutput } from '@/components/workspace/chat-panel/flow-proposal'
import type { FlowTemplate } from '@/lib/flows/import-export'
import { createDefaultFlowDefinition } from '@/lib/flows/validation'

function createTemplate(): FlowTemplate {
  return {
    cronExpression: '0 9 * * 1',
    definition: createDefaultFlowDefinition(),
    description: 'Automates the weekly review',
    enabled: true,
    format: 'arche-flow-template/v1',
    name: 'Weekly review',
    timezone: 'UTC',
  }
}

describe('flow proposal chat output', () => {
  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
  })

  it('parses validated flow proposal tool output', () => {
    const template = createTemplate()

    expect(parseFlowProposalOutput(JSON.stringify({
      format: 'arche-flow-template/v1',
      ok: true,
      template,
      validation: { ok: true },
      warnings: [{ message: 'Review target agents.' }],
    }))).toEqual({
      template,
      warnings: ['Review target agents.'],
    })
  })

  it('does not parse failed validation output', () => {
    expect(parseFlowProposalOutput(JSON.stringify({
      format: 'arche-flow-template/v1',
      ok: false,
      validation: { ok: false, error: 'invalid_flow_nodes' },
    }))).toBeNull()
  })

  it('renders a review link that stores the template draft', () => {
    const template = createTemplate()

    render(<FlowProposalCard proposal={{ template, warnings: ['Review target agents.'] }} isRunning={false} slug="alice" />)

    expect(screen.getByText('Flow proposal')).toBeTruthy()
    expect(screen.getByText('Weekly review')).toBeTruthy()
    expect(screen.getByText('Review target agents.')).toBeTruthy()

    const link = screen.getByRole('link', { name: 'Review & create' })
    link.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(link)

    const pointer = window.sessionStorage.getItem('arche:flow-template')
    expect(pointer).toBeTruthy()
    expect(window.sessionStorage.getItem(`arche:flow-template:${pointer}`)).toContain('Weekly review')
  })
})

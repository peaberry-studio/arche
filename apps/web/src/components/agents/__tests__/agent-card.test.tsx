/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentCard } from '@/components/agents/agent-card'

describe('AgentCard', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders admin edit button and metadata', () => {
    const onEdit = vi.fn()

    render(
      <AgentCard
        displayName="Researcher"
        agentId="researcher"
        description="Finds context"
        model="openai/gpt-5.5"
        onEdit={onEdit}
        isPrimary
        isAdmin
      />
    )

    expect(screen.getByText('Researcher')).not.toBeNull()
    expect(screen.getByText('Finds context')).not.toBeNull()
    expect(screen.getByText('Primary')).not.toBeNull()
    expect(screen.getByText('openai/gpt-5.5')).not.toBeNull()

    fireEvent.click(screen.getByLabelText('Edit agent'))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('renders admin edit link for href-based edit actions', () => {
    render(
      <AgentCard
        displayName="Writer"
        agentId="writer"
        editHref="/u/alice/agents/writer"
        isPrimary={false}
        isAdmin
      />
    )

    expect(screen.getByText('Secondary')).not.toBeNull()
    expect(screen.getByLabelText('Edit agent').getAttribute('href')).toBe('/u/alice/agents/writer')
  })
})

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DashboardHero } from '@/components/dashboard/dashboard-hero'
import { takeWorkspaceStartPrompt } from '@/lib/workspace-start-prompt'

const pushMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

function renderDashboardHero() {
  return render(
    <DashboardHero
      slug="alice"
      agents={[
        {
          id: 'strategist',
          displayName: 'Strategist',
          description: 'Planning expert',
        },
      ]}
      recentUpdates={[
        {
          fileName: 'Plan',
          filePath: 'docs/plan.md',
        },
      ]}
      skills={[
        {
          name: 'research',
          description: 'Research workflow',
        },
      ]}
    />,
  )
}

describe('DashboardHero', () => {
  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
    pushMock.mockClear()
  })

  it('keeps send disabled until there is text or a selected context item', () => {
    renderDashboardHero()

    const sendButton = screen.getByRole('button', { name: 'Start working' }) as HTMLButtonElement
    expect(sendButton.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /^Skills/ }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /research/i }))

    expect(sendButton.disabled).toBe(false)
  })

  it('persists the composed prompt with selected file context before routing', () => {
    renderDashboardHero()

    fireEvent.change(screen.getByPlaceholderText('Describe what you want to work on...'), {
      target: { value: 'Draft the execution plan' },
    })

    fireEvent.click(screen.getByRole('button', { name: /^Knowledge/ }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Plan/i }))

    fireEvent.click(screen.getByRole('button', { name: /^Skills/ }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /research/i }))

    fireEvent.click(screen.getByRole('button', { name: /^Experts/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Strategist/i }))

    fireEvent.click(screen.getByRole('button', { name: 'Start working' }))

    expect(takeWorkspaceStartPrompt(window.sessionStorage, 'alice')).toEqual({
      text: '@strategist [[docs/plan.md]] /research\n\nDraft the execution plan',
      contextPaths: ['docs/plan.md'],
    })
    expect(pushMock).toHaveBeenCalledWith('/w/alice')
  })

  it('closes an open picker on Escape', () => {
    renderDashboardHero()

    fireEvent.click(screen.getByRole('button', { name: /^Knowledge/ }))
    expect(screen.getByRole('menu', { name: 'Knowledge' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu', { name: 'Knowledge' })).toBeNull()
  })
})

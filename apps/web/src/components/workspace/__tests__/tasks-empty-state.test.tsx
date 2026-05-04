/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TasksEmptyState } from '../tasks-empty-state'

afterEach(() => {
  cleanup()
})

describe('TasksEmptyState', () => {
  it('renders the empty state message', () => {
    render(<TasksEmptyState />)
    expect(screen.getByText('Run an autopilot task')).toBeDefined()
    expect(screen.getByText(/Pick a task from the sidebar/)).toBeDefined()
  })

  it('renders instructions paragraph', () => {
    render(<TasksEmptyState />)
    expect(
      screen.getByText('Pick a task from the sidebar to launch a new run, or open a previous run to continue the conversation.')
    ).toBeDefined()
  })

  it('renders the Lightning icon wrapper', () => {
    const { container } = render(<TasksEmptyState />)
    const iconWrapper = container.querySelector('.rounded-full')
    expect(iconWrapper).toBeTruthy()
  })

  it('renders with centering styles', () => {
    const { container } = render(<TasksEmptyState />)
    const root = container.firstElementChild
    expect(root).toBeTruthy()
    expect(root?.classList.contains('items-center')).toBe(true)
    expect(root?.classList.contains('justify-center')).toBe(true)
  })
})

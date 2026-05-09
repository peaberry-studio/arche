/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceModeToggle } from '@/components/workspace/workspace-mode-toggle'

describe('WorkspaceModeToggle', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('switches between modes and caps the knowledge badge label', () => {
    const onModeChange = vi.fn()

    render(
      <WorkspaceModeToggle
        mode="chat"
        knowledgePendingCount={120}
        onModeChange={onModeChange}
      />
    )

    expect(screen.getByLabelText('120 pending')).toBeTruthy()
    expect(screen.getByText('99+')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
    fireEvent.click(screen.getByRole('button', { name: /Knowledge/ }))

    expect(onModeChange).toHaveBeenNthCalledWith(1, 'tasks')
    expect(onModeChange).toHaveBeenNthCalledWith(2, 'knowledge')
  })

  it('hides tasks mode and still allows returning to sessions', () => {
    const onModeChange = vi.fn()

    render(
      <WorkspaceModeToggle
        mode="knowledge"
        hideTasks
        onModeChange={onModeChange}
      />
    )

    expect(screen.queryByText('Tasks')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }))

    expect(onModeChange).toHaveBeenCalledWith('chat')
  })

  it('remeasures the active indicator when the knowledge badge disappears', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const isActiveButton = this instanceof HTMLButtonElement && this.getAttribute('aria-pressed') === 'true'
      const hasPendingBadge = this instanceof HTMLButtonElement && this.querySelector('[aria-label="3 pending"]') !== null
      const width = isActiveButton
        ? hasPendingBadge ? 120 : 96
        : 240

      return {
        bottom: 32,
        height: 32,
        left: 0,
        right: width,
        top: 0,
        width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    })

    const { container, rerender } = render(
      <WorkspaceModeToggle
        mode="knowledge"
        knowledgePendingCount={3}
        onModeChange={vi.fn()}
      />
    )
    const indicator = container.querySelector('[aria-hidden="true"]') as HTMLElement

    expect(indicator.style.width).toBe('120px')

    rerender(
      <WorkspaceModeToggle
        mode="knowledge"
        knowledgePendingCount={0}
        onModeChange={vi.fn()}
      />
    )

    expect(indicator.style.width).toBe('96px')
  })
})

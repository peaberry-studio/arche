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
})

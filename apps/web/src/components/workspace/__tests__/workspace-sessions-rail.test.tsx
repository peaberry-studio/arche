/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceSessionsRail } from '@/components/workspace/workspace-sessions-rail'
import type { WorkspaceSession } from '@/lib/opencode/types'

const sessions: WorkspaceSession[] = [
  {
    id: 'idle-chat',
    title: 'Idle chat',
    status: 'idle',
    updatedAt: '5m',
    updatedAtRaw: 1,
  },
  {
    id: 'busy-chat',
    title: 'Busy chat',
    status: 'busy',
    updatedAt: '4m',
    updatedAtRaw: 2,
  },
  {
    id: 'error-chat',
    title: 'Error chat',
    status: 'error',
    updatedAt: '3m',
    updatedAtRaw: 3,
  },
  {
    id: 'done-chat',
    title: 'Done chat',
    status: 'idle',
    updatedAt: '2m',
    updatedAtRaw: 4,
  },
  {
    id: 'task-session',
    title: 'Autopilot | Daily summary',
    status: 'idle',
    updatedAt: '1m',
    updatedAtRaw: 5,
    autopilot: {
      runId: 'run-1',
      taskId: 'task-1',
      taskName: 'Daily summary',
      trigger: 'manual',
      hasUnseenResult: true,
    },
  },
]

function dotFor(name: string) {
  const dot = screen.getByRole('button', { name }).querySelector('span')
  if (!dot) {
    throw new Error(`missing dot for ${name}`)
  }

  return dot
}

describe('WorkspaceSessionsRail', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders chat session dots with status colors and click handling', () => {
    const onSelectSession = vi.fn()

    render(
      <WorkspaceSessionsRail
        kind="chats"
        sessions={sessions}
        activeSessionId="idle-chat"
        unseenCompletedSessions={new Set(['done-chat'])}
        onSelectSession={onSelectSession}
      />
    )

    const rail = screen.getByLabelText('Chats')
    Object.defineProperty(rail, 'scrollTop', { configurable: true, value: 12 })
    rail.getBoundingClientRect = () => ({
      bottom: 180,
      height: 180,
      left: 0,
      right: 48,
      top: 20,
      width: 48,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    })

    fireEvent.mouseMove(rail, { clientY: 74 })
    fireEvent.mouseLeave(rail)

    expect(screen.queryByRole('button', { name: 'Daily summary' })).toBeNull()
    expect(dotFor('Idle chat').className).toContain('bg-primary')
    expect(dotFor('Busy chat').className).toContain('bg-amber-400')
    expect(dotFor('Error chat').className).toContain('bg-red-400')
    expect(dotFor('Done chat').className).toContain('bg-green-400')

    fireEvent.click(screen.getByRole('button', { name: 'Done chat' }))

    expect(onSelectSession).toHaveBeenCalledWith('done-chat')
  })

  it('renders task dots and marks unseen autopilot runs as seen', () => {
    const onMarkAutopilotRunSeen = vi.fn()
    const onSelectSession = vi.fn()

    render(
      <WorkspaceSessionsRail
        kind="tasks"
        sessions={sessions}
        activeSessionId={null}
        unseenCompletedSessions={new Set<string>()}
        onMarkAutopilotRunSeen={onMarkAutopilotRunSeen}
        onSelectSession={onSelectSession}
      />
    )

    expect(screen.queryByRole('button', { name: 'Idle chat' })).toBeNull()
    expect(dotFor('Daily summary').className).toContain('bg-green-400')

    fireEvent.click(screen.getByRole('button', { name: 'Daily summary' }))

    expect(onSelectSession).toHaveBeenCalledWith('task-session')
    expect(onMarkAutopilotRunSeen).toHaveBeenCalledWith('run-1')
  })

  it('magnifies, accents, and spaces dots around the cursor smoothly', async () => {
    render(
      <WorkspaceSessionsRail
        kind="chats"
        sessions={sessions}
        activeSessionId={null}
        unseenCompletedSessions={new Set<string>()}
        onSelectSession={vi.fn()}
      />
    )

    const rail = screen.getByLabelText('Chats')
    Object.defineProperty(rail, 'scrollTop', { configurable: true, value: 0 })
    rail.getBoundingClientRect = () => ({
      bottom: 180,
      height: 180,
      left: 0,
      right: 48,
      top: 0,
      width: 48,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const focusedButton = screen.getByRole('button', { name: 'Busy chat' })
    const focusedDot = dotFor('Busy chat')
    const previousDot = dotFor('Idle chat')

    fireEvent.mouseMove(rail, { clientY: 33 })

    await waitFor(() => expect(focusedDot.className).toContain('bg-primary'))
    await waitFor(() => expect(previousDot.style.transform).toContain('translate3d(0, -'))

    expect(previousDot.className).not.toContain('bg-primary')
    expect(focusedDot.style.transform).toContain('translate3d(0,')
    expect(focusedButton.style.height).toBe('22px')
    expect(Number(focusedButton.style.opacity)).toBeGreaterThan(0)
  })

  it('renders nothing when the selected rail kind has no sessions', () => {
    const { container } = render(
      <WorkspaceSessionsRail
        kind="tasks"
        sessions={sessions.filter((session) => !session.autopilot)}
        activeSessionId={null}
        unseenCompletedSessions={new Set<string>()}
        onSelectSession={vi.fn()}
      />
    )

    expect(container.firstChild).toBeNull()
  })
})

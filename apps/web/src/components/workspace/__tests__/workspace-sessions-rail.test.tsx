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
    id: 'flow-session',
    title: 'Flow | Daily summary',
    status: 'idle',
    updatedAt: '1m',
    updatedAtRaw: 5,
    flow: {
      runId: 'run-1',
      flowId: 'flow-1',
      flowName: 'Daily summary',
      status: 'succeeded',
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

function renderRail(overrides: Record<string, unknown> = {}) {
  const props = {
    sessions,
    activeSessionId: null,
    unseenCompletedSessions: new Set<string>(),
    onSelectSession: vi.fn(),
    ...overrides,
  } as Parameters<typeof WorkspaceSessionsRail>[0]
  return render(<WorkspaceSessionsRail {...props} />)
}

describe('WorkspaceSessionsRail', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders dots for both chat and flow sessions', () => {
    renderRail()

    expect(screen.queryByRole('button', { name: 'Idle chat' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Daily summary' })).toBeTruthy()
    expect(dotFor('Idle chat').className).toContain('bg-muted-foreground')
    expect(dotFor('Daily summary').className).toContain('bg-green-400')
  })

  it('filters out subagent sessions from the rail', () => {
    render(
      <WorkspaceSessionsRail
        sessions={[
          ...sessions,
          {
            id: 'child-session',
            title: 'Child session',
            status: 'idle',
            updatedAt: 'now',
            updatedAtRaw: 6,
            parentId: 'idle-chat',
          },
        ]}
        activeSessionId={null}
        unseenCompletedSessions={new Set<string>()}
        onSelectSession={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Child session' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Idle chat' })).toBeTruthy()
  })

  it('highlights the active session whether it is a chat or a flow', () => {
    renderRail({ activeSessionId: 'flow-session' })

    expect(dotFor('Daily summary').className).toContain('bg-green-400')
  })

  it('colors waiting-for-human flow dots amber', () => {
    renderRail({
      sessions: [
        ...sessions,
        {
          id: 'waiting-flow',
          title: 'Flow | Approval needed',
          status: 'idle',
          updatedAt: 'now',
          updatedAtRaw: 6,
          flow: {
            runId: 'run-2',
            flowId: 'flow-2',
            flowName: 'Approval needed',
            status: 'waiting_for_human',
            trigger: 'manual',
            hasUnseenResult: false,
          },
        },
      ],
    })

    expect(dotFor('Approval needed').className).toContain('bg-amber-400')
  })

  it('renders chat session dots with status colors and click handling', () => {
    const onSelectSession = vi.fn()

    render(
      <WorkspaceSessionsRail
        sessions={sessions}
        activeSessionId="idle-chat"
        unseenCompletedSessions={new Set(['done-chat'])}
        onSelectSession={onSelectSession}
      />
    )

    const rail = screen.getByLabelText('Sessions')
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

    expect(dotFor('Idle chat').className).toContain('bg-primary')
    expect(dotFor('Busy chat').className).toContain('bg-amber-400')
    expect(dotFor('Error chat').className).toContain('bg-red-400')
    expect(dotFor('Done chat').className).toContain('bg-green-400')

    fireEvent.click(screen.getByRole('button', { name: 'Done chat' }))

    expect(onSelectSession).toHaveBeenCalledWith('done-chat')
  })

  it('marks unseen flow runs as seen on selection', () => {
    const onMarkFlowRunSeen = vi.fn()
    const onSelectSession = vi.fn()

    render(
      <WorkspaceSessionsRail
        sessions={sessions}
        activeSessionId={null}
        unseenCompletedSessions={new Set<string>()}
        onMarkFlowRunSeen={onMarkFlowRunSeen}
        onSelectSession={onSelectSession}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Daily summary' }))

    expect(onSelectSession).toHaveBeenCalledWith('flow-session')
    expect(onMarkFlowRunSeen).toHaveBeenCalledWith('run-1')
  })

  it('magnifies, accents, and spaces dots around the cursor smoothly', async () => {
    renderRail()

    const rail = screen.getByLabelText('Sessions')
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

    await waitFor(() => expect(focusedDot.style.transform).toContain('translate3d(0,'))
    await waitFor(() => expect(previousDot.style.transform).toContain('translate3d(0, -'))

    expect(previousDot.className).not.toContain('bg-primary')
    expect(focusedDot.className).toContain('bg-amber-400')
    expect(focusedDot.className).not.toContain('bg-primary')
    expect(focusedDot.style.transform).toContain('translate3d(0,')
    expect(focusedButton.style.height).toBe('22px')
    expect(Number(focusedButton.style.opacity)).toBeGreaterThan(0)
  })

  it('preserves cursor magnification when sessions refresh while hovering', async () => {
    const { rerender } = renderRail()

    const rail = screen.getByLabelText('Sessions')
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

    const previousDot = dotFor('Idle chat')
    fireEvent.mouseMove(rail, { clientY: 33 })

    await waitFor(() => expect(previousDot.style.transform).toContain('translate3d(0, -'))
    const hoveringTransform = previousDot.style.transform

    rerender(
      <WorkspaceSessionsRail
        sessions={sessions.map((session) => ({ ...session }))}
        activeSessionId={null}
        unseenCompletedSessions={new Set<string>()}
        onSelectSession={vi.fn()}
      />
    )

    expect(previousDot.style.transform).toBe(hoveringTransform)
  })

  it('renders nothing when there are no sessions', () => {
    const { container } = render(
      <WorkspaceSessionsRail
        sessions={[]}
        activeSessionId={null}
        unseenCompletedSessions={new Set<string>()}
        onSelectSession={vi.fn()}
      />
    )

    expect(container.firstChild).toBeNull()
  })
})

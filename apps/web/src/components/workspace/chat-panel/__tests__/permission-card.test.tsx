/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PermissionCard } from '@/components/workspace/chat-panel/permission-card'
import type { WorkspacePermission } from '@/lib/opencode/permission'
import type { PermissionResponse } from '@/lib/opencode/types'

function createPermission(): WorkspacePermission {
  return {
    id: 'perm-1',
    sessionId: 's1',
    title: 'Run command: pnpm test',
    state: 'pending',
    pattern: 'bash(pnpm test)',
    metadata: { tool: 'bash' },
  }
}

describe('PermissionCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the pending state with the shared tool-card surface', () => {
    const { container } = render(<PermissionCard permission={createPermission()} />)

    const card = container.firstElementChild
    expect(card?.className).toContain('border-border/40')
    expect(card?.className).toContain('bg-muted/20')
    expect(card?.className).toContain('rounded-lg')
    expect(card?.className).not.toContain('warning')
    expect(screen.getByText('Approval required')).toBeTruthy()

    const subtitle = screen.getByText('Run command: pnpm test')
    expect(subtitle.className).toContain('truncate')
    expect(subtitle.className).toContain('pl-5')
    expect(subtitle.className).toContain('text-muted-foreground')
    expect(subtitle.textContent).toBe('Run command: pnpm test')
  })

  it('renders explicit action labels with a homogeneous solid hierarchy', () => {
    render(<PermissionCard permission={createPermission()} onAnswerPermission={vi.fn()} />)

    const allowOnce = screen.getByRole('button', { name: 'Allow once' })
    expect(allowOnce.className).toContain('bg-warning')
    expect(allowOnce.className).toContain('text-foreground')

    const session = screen.getByRole('button', { name: 'Allow for this session' })
    expect(session.className).toContain('bg-primary-foreground/60')
    expect(session.className).toContain('dark:bg-foreground/5')

    const reject = screen.getByRole('button', { name: 'Reject' })
    expect(reject.className).toContain('bg-primary-foreground/60')
    expect(reject.className).toContain('dark:bg-foreground/5')
    expect(reject.className).not.toContain('ml-auto')
    expect(reject.className).not.toContain('bg-destructive')
    expect(reject.className).not.toContain('dark:text-destructive')
  })

  it.each([
    ['Allow once', 'once'],
    ['Reject', 'reject'],
    ['Allow for this session', 'always'],
  ] as const)('sends %s as %s', async (label, expected) => {
    const onAnswerPermission = vi.fn(async () => true)
    render(<PermissionCard permission={createPermission()} onAnswerPermission={onAnswerPermission} />)

    fireEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => {
      expect(onAnswerPermission).toHaveBeenCalledWith('s1', 'perm-1', expected satisfies PermissionResponse)
    })
  })

  it('announces submission failures with an alert', async () => {
    const onAnswerPermission = vi.fn(async () => false)
    render(<PermissionCard permission={createPermission()} onAnswerPermission={onAnswerPermission} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not send permission response.')
  })

  it('shows an unambiguous sending state and disables all actions while submitting', async () => {
    let resolveAnswer: (value: boolean) => void = () => undefined
    const onAnswerPermission = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveAnswer = resolve
        }),
    )
    render(<PermissionCard permission={createPermission()} onAnswerPermission={onAnswerPermission} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    const sending = await screen.findByRole('button', { name: 'Sending...' })
    expect(sending).toBeTruthy()
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }

    resolveAnswer(true)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy()
    })
  })

  it('keeps actions disabled without a handler (read-only conversation)', () => {
    render(<PermissionCard permission={createPermission()} />)

    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

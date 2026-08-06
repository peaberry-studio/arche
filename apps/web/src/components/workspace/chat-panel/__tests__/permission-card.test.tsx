/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PermissionCard } from '@/components/workspace/chat-panel/permission-card'
import type { MessagePart, PermissionResponse, PermissionState } from '@/lib/opencode/types'

type PermissionPart = Extract<MessagePart, { type: 'permission' }>

function createPart(state: PermissionState): PermissionPart {
  return {
    type: 'permission',
    id: 'part-1',
    permissionId: 'perm-1',
    sessionId: 's1',
    title: 'Run command: pnpm test',
    state,
    pattern: 'bash(pnpm test)',
    metadata: { tool: 'bash' },
  }
}

describe('PermissionCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the pending state with a warning surface', () => {
    const { container } = render(<PermissionCard part={createPart('pending')} />)

    const card = container.firstElementChild
    expect(card?.className).toContain('border-warning/25')
    expect(card?.className).toContain('bg-warning/5')
    expect(screen.getByText('Approval required')).toBeTruthy()

    const actionLine = screen.getByText(/Run command: pnpm test/)
    expect(actionLine.className).toContain('truncate')
    expect(actionLine.textContent).toContain('bash:')
    expect(actionLine.textContent).toContain('Run command: pnpm test')

    const metadata = screen.getByText('bash:')
    expect(metadata.className).toContain('font-mono')
    expect(metadata.className).toContain('chat-text-micro')
    expect(metadata.className).toContain('text-muted-foreground')
  })

  it('renders the approved state with a primary surface and no actions', () => {
    const { container } = render(<PermissionCard part={createPart('approved')} />)

    const card = container.firstElementChild
    expect(card?.className).toContain('border-primary/25')
    expect(card?.className).toContain('bg-primary/5')
    expect(card?.className).not.toContain('warning')
    expect(screen.getByText('Permission granted')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders the rejected state with a destructive surface and no actions', () => {
    const { container } = render(<PermissionCard part={createPart('rejected')} />)

    const card = container.firstElementChild
    expect(card?.className).toContain('border-destructive/25')
    expect(card?.className).toContain('bg-destructive/5')
    expect(screen.getByText('Permission rejected')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders explicit action labels with a homogeneous solid hierarchy', () => {
    render(<PermissionCard part={createPart('pending')} onAnswerPermission={vi.fn()} />)

    const allowOnce = screen.getByRole('button', { name: 'Allow once' })
    expect(allowOnce.className).toContain('bg-warning')
    expect(allowOnce.className).toContain('text-foreground')

    const session = screen.getByRole('button', { name: 'Allow for this session' })
    expect(session.className).toContain('bg-primary-foreground/60')
    expect(session.className).toContain('dark:bg-foreground/5')

    const reject = screen.getByRole('button', { name: 'Reject' })
    expect(reject.className).toContain('bg-destructive')
    expect(reject.className).toContain('dark:bg-destructive/15')
    expect(reject.className).toContain('dark:text-destructive')
  })

  it.each([
    ['Allow once', 'once'],
    ['Reject', 'reject'],
    ['Allow for this session', 'always'],
  ] as const)('sends %s as %s', async (label, expected) => {
    const onAnswerPermission = vi.fn(async () => true)
    render(<PermissionCard part={createPart('pending')} onAnswerPermission={onAnswerPermission} />)

    fireEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => {
      expect(onAnswerPermission).toHaveBeenCalledWith('s1', 'perm-1', expected satisfies PermissionResponse)
    })
  })

  it('announces submission failures with an alert', async () => {
    const onAnswerPermission = vi.fn(async () => false)
    render(<PermissionCard part={createPart('pending')} onAnswerPermission={onAnswerPermission} />)

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
    render(<PermissionCard part={createPart('pending')} onAnswerPermission={onAnswerPermission} />)

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
    render(<PermissionCard part={createPart('pending')} />)

    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

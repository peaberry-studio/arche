/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConflictResolverDialog } from '@/components/workspace/conflict-resolver-dialog'

const mocks = vi.hoisted(() => ({
  getWorkspaceConflictAction: vi.fn(),
  resolveWorkspaceConflictAction: vi.fn(),
}))

vi.mock('@/actions/workspace-agent', () => ({
  getWorkspaceConflictAction: mocks.getWorkspaceConflictAction,
  resolveWorkspaceConflictAction: mocks.resolveWorkspaceConflictAction,
}))

const conflict = {
  ours: 'local content',
  theirs: 'kb content',
  working: 'working content',
}

function renderDialog(overrides?: Partial<Parameters<typeof ConflictResolverDialog>[0]>) {
  return render(
    <ConflictResolverDialog
      slug="alice"
      path="Notes/Conflict.md"
      open
      onOpenChange={vi.fn()}
      onResolved={vi.fn()}
      {...overrides}
    />
  )
}

describe('ConflictResolverDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWorkspaceConflictAction.mockResolvedValue({ ok: true, conflict })
    mocks.resolveWorkspaceConflictAction.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    cleanup()
  })

  it('loads conflict data and resolves with manual content', async () => {
    const onOpenChange = vi.fn()
    const onResolved = vi.fn()
    renderDialog({ onOpenChange, onResolved })

    expect(await screen.findByText('local content')).toBeTruthy()
    expect(mocks.getWorkspaceConflictAction).toHaveBeenCalledWith('alice', 'Notes/Conflict.md')

    fireEvent.click(screen.getByRole('button', { name: 'Keep KB' }))
    expect(screen.getByText('kb content')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    expect(screen.getByText('Local version')).toBeTruthy()
    expect(screen.getByText('KB version')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'merged content' } })
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() => {
      expect(mocks.resolveWorkspaceConflictAction).toHaveBeenCalledWith('alice', {
        path: 'Notes/Conflict.md',
        strategy: 'manual',
        content: 'merged content',
      })
    })
    expect(onResolved).toHaveBeenCalledWith('Notes/Conflict.md', 'merged content')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows load errors and keeps resolve disabled', async () => {
    mocks.getWorkspaceConflictAction.mockResolvedValueOnce({ ok: false, error: 'missing_conflict' })

    renderDialog()

    expect(await screen.findByText('missing_conflict')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resolve' }).hasAttribute('disabled')).toBe(true)
  })

  it('shows thrown load errors', async () => {
    mocks.getWorkspaceConflictAction.mockRejectedValueOnce(new Error('agent offline'))

    renderDialog()

    expect(await screen.findByText('agent offline')).toBeTruthy()
  })

  it('surfaces resolution failures and supports cancel', async () => {
    const onOpenChange = vi.fn()
    mocks.resolveWorkspaceConflictAction.mockResolvedValueOnce({ ok: false, error: 'write_failed' })

    renderDialog({ onOpenChange })
    await screen.findByText('local content')
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))

    expect(await screen.findByText('write_failed')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

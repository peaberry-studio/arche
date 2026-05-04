/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReviewPanel } from '@/components/workspace/review-panel'
import type { WorkspaceDiff } from '@/hooks/use-workspace'

afterEach(() => {
  cleanup()
})

function makeDiff(overrides: Partial<WorkspaceDiff> = {}): WorkspaceDiff {
  return {
    additions: 2,
    conflicted: false,
    deletions: 1,
    diff: '@@ -1 +1 @@\n-old\n+new',
    path: 'Notes/A.md',
    status: 'modified',
    ...overrides,
  }
}

describe('ReviewPanel', () => {
  it('renders error and empty states', () => {
    const onOpenFile = vi.fn()

    const { rerender } = render(
      <ReviewPanel diffs={[]} error="git unavailable" onOpenFile={onOpenFile} slug="alice" />
    )

    expect(screen.getByText('Unable to load changes')).toBeDefined()
    expect(screen.getByText('git unavailable')).toBeDefined()

    rerender(<ReviewPanel diffs={[]} isLoading onOpenFile={onOpenFile} slug="alice" />)
    expect(screen.getByText('Loading changes…')).toBeDefined()

    rerender(<ReviewPanel diffs={[]} onOpenFile={onOpenFile} slug="alice" />)
    expect(screen.getByText('No pending changes')).toBeDefined()
  })

  it('opens diffs, toggles long previews, and discards changes', async () => {
    const onDiscardFileChanges = vi.fn(async () => ({ ok: true as const }))
    const onOpenFile = vi.fn()
    const longDiff = Array.from({ length: 125 }, (_value, index) => `+line ${index}`).join('\n')
    const diffs = [
      makeDiff({ diff: longDiff, path: 'Notes/A.md' }),
      makeDiff({ additions: 1, conflicted: true, deletions: 0, path: 'Notes/Conflict.md' }),
    ]

    render(
      <ReviewPanel
        diffs={diffs}
        onDiscardFileChanges={onDiscardFileChanges}
        onOpenFile={onOpenFile}
        slug="alice"
      />
    )

    expect(screen.getByText('Detected 1 conflict. Resolve the files before publishing.')).toBeDefined()
    expect(screen.getByText('Conflict')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /Notes\/A\.md/ }))
    fireEvent.click(screen.getByRole('button', { name: 'View diff' }))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Discard changes' })[0])

    expect(onOpenFile).toHaveBeenCalledWith('Notes/A.md')
    expect(screen.getByText('Discard changes?')).toBeDefined()
    expect(screen.getAllByText('Notes/A.md').length).toBeGreaterThan(1)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(onDiscardFileChanges).toHaveBeenCalledWith('Notes/A.md'))
    await waitFor(() => expect(screen.queryByText('Discard changes?')).toBeNull())
  })

  it('keeps the discard dialog open when discarding fails', async () => {
    const onDiscardFileChanges = vi.fn(async () => ({ ok: false as const, error: 'cannot discard' }))

    render(
      <ReviewPanel
        diffs={[makeDiff()]}
        onDiscardFileChanges={onDiscardFileChanges}
        onOpenFile={vi.fn()}
        slug="alice"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(await screen.findByText('cannot discard')).toBeDefined()
    expect(screen.getByText('Discard changes?')).toBeDefined()
  })
})

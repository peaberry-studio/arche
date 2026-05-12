/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GitHubConflictSection } from '@/components/workspace/github-conflict-section'
import { ReviewPanel } from '@/components/workspace/review-panel'
import type { WorkspaceDiff } from '@/hooks/use-workspace'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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

  it('shows GitHub conflict resolution when there are no workspace diffs', () => {
    render(
      <ReviewPanel
        diffs={[]}
        githubConflictFiles={['docs/intro.md']}
        githubMergePending
        onOpenFile={vi.fn()}
        slug="alice"
      />
    )

    expect(screen.getByText('GitHub sync conflicts in 1 file')).toBeDefined()
    expect(screen.getByText('docs/intro.md')).toBeDefined()
    expect(screen.queryByText('No pending changes')).toBeNull()
  })

  it('allows finalizing a pending GitHub merge after files are resolved', () => {
    render(
      <ReviewPanel
        diffs={[]}
        githubConflictFiles={[]}
        githubMergePending
        onOpenFile={vi.fn()}
        slug="alice"
      />
    )

    expect(screen.getByText('GitHub sync merge ready to finalize')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Finalize Merge' }).hasAttribute('disabled')).toBe(false)
  })

  it('shows a manual GitHub pull action when publishing needs remote changes first', async () => {
    const onPullGithubChanges = vi.fn(async () => ({
      ok: true,
      status: 'synced' as const,
      githubSyncStatus: 'pulled',
    }))

    render(
      <ReviewPanel
        diffs={[]}
        githubSyncRequired
        githubSyncMessage="Push rejected — the remote has newer changes. Pull from GitHub first."
        onOpenFile={vi.fn()}
        onPullGithubChanges={onPullGithubChanges}
        slug="alice"
      />
    )

    expect(screen.getByText('KB sync required')).toBeDefined()
    expect(screen.getByText(/remote has newer changes/)).toBeDefined()
    expect(screen.queryByText('No pending changes')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Pull from GitHub' }))

    await waitFor(() => expect(onPullGithubChanges).toHaveBeenCalledTimes(1))
  })

  it('surfaces manual GitHub pull errors in the review panel', async () => {
    const onPullGithubChanges = vi.fn(async () => ({
      ok: true,
      status: 'synced' as const,
      githubSyncStatus: 'error',
    }))

    render(
      <ReviewPanel
        diffs={[]}
        githubSyncRequired
        onOpenFile={vi.fn()}
        onPullGithubChanges={onPullGithubChanges}
        slug="alice"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pull from GitHub' }))

    expect(await screen.findByText('Pull from GitHub did not complete. The remote may still have newer changes.')).toBeDefined()
  })

  it('keeps finalize disabled when a refreshed conflict list still has unresolved files', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }

      if (url.includes('/conflicts/resolve?')) {
        return new Response(
          JSON.stringify({
            path: 'docs/a.md',
            ours: 'local',
            theirs: 'remote',
            working: '<<<<<<< HEAD\nlocal\n=======\nremote\n>>>>>>> github/main',
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        )
      }

      return new Response(JSON.stringify({ error: 'unexpected_request' }), {
        headers: { 'content-type': 'application/json' },
        status: 500,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onFileResolved = vi.fn()
    const onMergeFinalized = vi.fn()
    const onMergeAborted = vi.fn()

    const { rerender } = render(
      <GitHubConflictSection
        conflictFiles={['docs/a.md', 'docs/b.md']}
        mergePending
        onFileResolved={onFileResolved}
        onMergeAborted={onMergeAborted}
        onMergeFinalized={onMergeFinalized}
        slug="alice"
      />,
    )

    await screen.findByDisplayValue(/local/)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Resolved' }))

    await waitFor(() => expect(onFileResolved).toHaveBeenCalledWith('docs/a.md'))

    rerender(
      <GitHubConflictSection
        conflictFiles={['docs/b.md']}
        mergePending
        onFileResolved={onFileResolved}
        onMergeAborted={onMergeAborted}
        onMergeFinalized={onMergeFinalized}
        slug="alice"
      />,
    )

    expect(screen.getByRole('button', { name: 'Finalize Merge' }).hasAttribute('disabled')).toBe(true)
  })
})

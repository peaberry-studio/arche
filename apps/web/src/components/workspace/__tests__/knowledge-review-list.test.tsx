/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeReviewList } from '@/components/workspace/knowledge-review-list'
import type { KnowledgeReviewChange, LearningRun } from '@/types/learning'

vi.mock('@/components/workspace/markdown-editor', () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea
      aria-label="Edit proposal content"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}))

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function makeChange(overrides: Partial<KnowledgeReviewChange> = {}): KnowledgeReviewChange {
  return {
    id: 'change-1',
    sourceProposalId: null,
    regeneratedFromId: null,
    runId: null,
    author: 'knowledge-curator',
    agent: 'knowledge-curator',
    origin: 'learning',
    title: 'Remember preference',
    reason: 'Durable user preference.',
    evidence: { quote: 'Use concise answers' },
    confidence: 0.8,
    kbPath: 'Preferences/Answers.md',
    operation: 'update',
    baseContent: '# Preference\n',
    baseHash: 'sha256:old',
    proposedContent: '# Preference\n\nUse **concise** answers.\n',
    status: 'open',
    actualContent: null,
    actualHash: null,
    appliedHash: null,
    publishCommitSha: null,
    auditTrail: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeRun(overrides: Partial<LearningRun> = {}): LearningRun {
  return {
    id: 'run-1',
    sourceSessionId: null,
    internalSessionId: null,
    regenerationChangeId: null,
    title: 'Learn from session',
    trigger: 'manual',
    status: 'running',
    error: null,
    messageCount: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const learningResponse = (proposals: KnowledgeReviewChange[], runs: LearningRun[] = []) => ({ runs, proposals })

describe('KnowledgeReviewList', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders open changes with title, reason, and metadata', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(learningResponse([makeChange()])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    expect(screen.getByText('Durable user preference.')).toBeTruthy()
    expect(screen.getByText('update')).toBeTruthy()
    expect(screen.getByText('Preferences/Answers.md')).toBeTruthy()
    expect(screen.getByText('· 80%')).toBeTruthy()
    expect(screen.getByText('by Knowledge Curator')).toBeTruthy()
    expect(screen.getByText('Use concise answers')).toBeTruthy()
  })

  it('notifies the parent when a proposal title is clicked', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(learningResponse([makeChange()])))
    const onOpenProposal = vi.fn()

    render(<KnowledgeReviewList slug="alice" onOpenProposal={onOpenProposal} />)

    fireEvent.click(await screen.findByText('Remember preference'))

    expect(onOpenProposal).toHaveBeenCalledTimes(1)
    const [change, content] = onOpenProposal.mock.calls[0]
    expect(change).toMatchObject({ id: 'change-1', kbPath: 'Preferences/Answers.md' })
    expect(content).toBe('# Preference\n\nUse **concise** answers.\n')
  })

  it('hides the generic curator reason but keeps the author attribution', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(learningResponse([
      makeChange({ reason: 'Proposed by the knowledge curator.' }),
    ])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    expect(screen.queryByText('Proposed by the knowledge curator.')).toBeNull()
    expect(screen.getByText('by Knowledge Curator')).toBeTruthy()
  })

  it('shows the empty state when no open changes exist', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(learningResponse([])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('No knowledge proposals awaiting review.')).toBeTruthy()
    expect(screen.getByText('Agent and curator suggestions appear here. They are not on disk until you Apply.')).toBeTruthy()
  })

  it('shows a readable error label when the load fails on the network', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Could not load Knowledge proposals.')).toBeTruthy()
  })

  it('surfaces action errors with readable labels', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange()])))
      .mockResolvedValueOnce(jsonResponse({ error: 'needs_rebase' }, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange({ status: 'needs_rebase' })])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('The target file changed. Rebase the proposal before applying it.')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })

  it('applies a change and notifies the workspace', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange()])))
      .mockResolvedValueOnce(jsonResponse({ proposal: { id: 'change-1' } }))
      .mockResolvedValueOnce(jsonResponse(learningResponse([])))
    const onApplied = vi.fn()

    render(<KnowledgeReviewList slug="alice" onApplied={onApplied} />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/learning/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply',
          proposalId: 'change-1',
          content: '# Preference\n\nUse **concise** answers.\n',
        }),
      })
    })
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
  })

  it('rejects a change without applying it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange()])))
      .mockResolvedValueOnce(jsonResponse({ proposal: { id: 'change-1' } }))
      .mockResolvedValueOnce(jsonResponse(learningResponse([])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/learning/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', proposalId: 'change-1', content: undefined }),
      })
    })
  })

  it('applies a delete change with empty content', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse([
        makeChange({ operation: 'delete', proposedContent: '', title: 'Remove old file' }),
      ])))
      .mockResolvedValueOnce(jsonResponse({ proposal: { id: 'change-1' } }))
      .mockResolvedValueOnce(jsonResponse(learningResponse([])))
    const onApplied = vi.fn()

    render(<KnowledgeReviewList slug="alice" onApplied={onApplied} />)

    expect(await screen.findByText('Remove old file')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/learning/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', proposalId: 'change-1', content: '' }),
      })
    })
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
  })

  it('shows rebase controls and disables apply for needs_rebase changes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(learningResponse([makeChange({ status: 'needs_rebase' })])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    expect(screen.getByText('Needs rebase')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Regenerate with curator' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use current base' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('rebases a needs_rebase change', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange({ status: 'needs_rebase' })])))
      .mockResolvedValueOnce(jsonResponse({ proposal: { id: 'change-1' } }))
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange()])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use current base' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/learning/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rebase', proposalId: 'change-1', content: undefined }),
      })
    })
  })

  it('requests curator regeneration for a needs_rebase change', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange({ status: 'needs_rebase' })])))
      .mockResolvedValueOnce(jsonResponse({ run: { id: 'run-1' } }))
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange({ status: 'needs_rebase' })])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate with curator' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/learning/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate', proposalId: 'change-1', content: undefined }),
      })
    })
  })

  it('flushes a pending debounced edit before rebasing so the draft is not lost', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange({ status: 'needs_rebase' })])))
      .mockResolvedValueOnce(jsonResponse({ proposal: { id: 'change-1' } }))
      .mockResolvedValueOnce(jsonResponse({ proposal: { id: 'change-1' } }))
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange()])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = await screen.findByRole('textbox', { name: 'Edit proposal content' })
    fireEvent.change(editor, { target: { value: '# Edited before rebase' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use current base' }))

    await waitFor(() => {
      const actions = fetchMock.mock.calls
        .filter(([, init]) => String(init?.method) === 'POST')
        .map(([, init]) => String(init?.body))
      const draftCall = actions.findIndex((body) => body.includes('save_draft'))
      const rebaseCall = actions.findIndex((body) => body.includes('"rebase"'))
      expect(draftCall).toBeGreaterThanOrEqual(0)
      expect(rebaseCall).toBeGreaterThanOrEqual(0)
      expect(draftCall).toBeLessThan(rebaseCall)
      expect(actions[draftCall]).toContain('# Edited before rebase')
    }, { timeout: 2000 })
  })

  it('flushes a pending debounced edit before regenerating so the draft is not lost', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange({ status: 'needs_rebase' })])))
      .mockResolvedValueOnce(jsonResponse({ proposal: { id: 'change-1' } }))
      .mockResolvedValueOnce(jsonResponse({ run: { id: 'run-1' } }))
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange({ status: 'needs_rebase' })])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = await screen.findByRole('textbox', { name: 'Edit proposal content' })
    fireEvent.change(editor, { target: { value: '# Edited before regenerate' } })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate with curator' }))

    await waitFor(() => {
      const actions = fetchMock.mock.calls
        .filter(([, init]) => String(init?.method) === 'POST')
        .map(([, init]) => String(init?.body))
      const draftCall = actions.findIndex((body) => body.includes('save_draft'))
      const regenerateCall = actions.findIndex((body) => body.includes('"regenerate"'))
      expect(draftCall).toBeGreaterThanOrEqual(0)
      expect(regenerateCall).toBeGreaterThanOrEqual(0)
      expect(draftCall).toBeLessThan(regenerateCall)
      expect(actions[draftCall]).toContain('# Edited before regenerate')
    }, { timeout: 2000 })
  })

  it('persists draft edits through save_draft', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse([makeChange()])))
      .mockResolvedValueOnce(jsonResponse({ proposal: { id: 'change-1' } }))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const editor = await screen.findByRole('textbox', { name: 'Edit proposal content' })
    fireEvent.change(editor, { target: { value: '# Edited content' } })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/learning/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_draft', proposalId: 'change-1', content: '# Edited content' }),
      })
    }, { timeout: 2000 })
  })

  it('shows a git-style diff against the current file for needs_rebase changes in raw mode', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(learningResponse([
      makeChange({
        status: 'needs_rebase',
        baseContent: 'Base content',
        actualContent: 'Current content',
        proposedContent: 'Proposed content',
      }),
    ])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    expect(await screen.findByText('-Current content')).toBeTruthy()
    expect(screen.getByText('+Proposed content')).toBeTruthy()
  })

  it('keeps proposals collapsed by default until a view mode is selected', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(learningResponse([makeChange()])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Preference' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByRole('heading', { name: 'Preference' })).toBeTruthy()
    expect(screen.getByText('concise')).toBeTruthy()
  })

  it('collapses the proposal again when the active view mode is clicked', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(learningResponse([makeChange()])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByRole('heading', { name: 'Preference' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.queryByRole('heading', { name: 'Preference' })).toBeNull()
  })

  it('refetches when refreshKey changes', async () => {
    fetchMock.mockResolvedValue(jsonResponse(learningResponse([makeChange()])))

    const { rerender } = render(<KnowledgeReviewList slug="alice" refreshKey={0} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    rerender(<KnowledgeReviewList slug="alice" refreshKey={1} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  describe('curator runs', () => {
    it('surfaces an in-progress run so a regeneration is not invisible', async () => {
      fetchMock.mockResolvedValue(jsonResponse(learningResponse([], [makeRun({ status: 'running' })])))

      render(<KnowledgeReviewList slug="alice" />)

      expect(await screen.findByText('Running')).toBeTruthy()
      expect(screen.getByText('Learn from session')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    })

    it('cancels an active run through the run cancel endpoint', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(learningResponse([], [makeRun({ status: 'running' })])))
        .mockResolvedValueOnce(jsonResponse({ run: { id: 'run-1', status: 'cancelled' } }))
        .mockResolvedValueOnce(jsonResponse(learningResponse([])))

      render(<KnowledgeReviewList slug="alice" />)

      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/learning/runs/run-1/cancel', { method: 'POST' })
      })
      await waitFor(() => expect(screen.queryByText('Running')).toBeNull())
    })

    it('surfaces a readable error when a run cannot be cancelled', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(learningResponse([], [makeRun({ status: 'running' })])))
        .mockResolvedValueOnce(jsonResponse({ error: 'run_not_cancelable' }, { status: 400 }))
        .mockResolvedValue(jsonResponse(learningResponse([], [makeRun({ status: 'running' })])))

      render(<KnowledgeReviewList slug="alice" />)

      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

      expect(await screen.findByText('This curator run can no longer be cancelled.')).toBeTruthy()
    })

    it('retries a failed run and shows why it failed', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(learningResponse([], [
          makeRun({ status: 'failed', error: 'instance_unavailable' }),
        ])))
        .mockResolvedValueOnce(jsonResponse({ run: { id: 'run-1' } }))
        .mockResolvedValue(jsonResponse(learningResponse([], [makeRun({ status: 'pending' })])))

      render(<KnowledgeReviewList slug="alice" />)

      expect(await screen.findByText('Failed')).toBeTruthy()
      expect(screen.getByText('The workspace instance is unavailable. Try again later.')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/learning', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: 'run-1' }),
        })
      })
    })

    it('offers to re-dispatch a run left pending past the dispatch window', async () => {
      const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      fetchMock.mockResolvedValue(jsonResponse(learningResponse([], [
        makeRun({ status: 'pending', createdAt: stale }),
      ])))

      render(<KnowledgeReviewList slug="alice" />)

      expect(await screen.findByText('Queued')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Run now' })).toBeTruthy()
    })

    it('keeps a recently queued run free of a re-dispatch button', async () => {
      fetchMock.mockResolvedValue(jsonResponse(learningResponse([], [
        makeRun({ status: 'pending', createdAt: new Date().toISOString() }),
      ])))

      render(<KnowledgeReviewList slug="alice" />)

      expect(await screen.findByText('Queued')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull()
    })

    it('hides settled runs whose outcome the proposal list already shows', async () => {
      fetchMock.mockResolvedValue(jsonResponse(learningResponse([], [
        makeRun({ id: 'run-ok', status: 'succeeded' }),
        makeRun({ id: 'run-cancelled', status: 'cancelled' }),
      ])))

      render(<KnowledgeReviewList slug="alice" />)

      expect(await screen.findByText('No knowledge proposals awaiting review.')).toBeTruthy()
      expect(screen.queryByText('Succeeded')).toBeNull()
      expect(screen.queryByText('Cancelled')).toBeNull()
    })
  })

  describe('polling', () => {
    // Advancing inside act() flushes the state update from the resolved fetch,
    // so the effect has re-armed the interval at the new cadence before the
    // next assertion.
    const advanceTimers = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('polls every 5s while a run is active so finished proposals appear', async () => {
      vi.useFakeTimers()
      fetchMock.mockResolvedValue(jsonResponse(learningResponse([], [makeRun({ status: 'running' })])))

      render(<KnowledgeReviewList slug="alice" />)
      await advanceTimers(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await advanceTimers(5_000)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      await advanceTimers(5_000)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('backs off to a slow poll when no run is active', async () => {
      vi.useFakeTimers()
      fetchMock.mockResolvedValue(jsonResponse(learningResponse([])))

      render(<KnowledgeReviewList slug="alice" />)
      await advanceTimers(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await advanceTimers(5_000)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await advanceTimers(40_000)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('stops polling once unmounted', async () => {
      vi.useFakeTimers()
      fetchMock.mockResolvedValue(jsonResponse(learningResponse([], [makeRun({ status: 'running' })])))

      const { unmount } = render(<KnowledgeReviewList slug="alice" />)
      await advanceTimers(0)
      unmount()

      await advanceTimers(30_000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it('sizes view panes against the panel instead of a fixed viewport height', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(learningResponse([makeChange()])))

    const { container } = render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await screen.findByRole('heading', { name: 'Preference' })
    expect(container.querySelector('.h-\\[70vh\\]')).toBeNull()
    expect(container.querySelector('.max-h-\\[60vh\\]')).toBeTruthy()
  })

  it('only shows open and needs_rebase changes, hiding applied ones', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(learningResponse([
      makeChange({ id: 'open-1', title: 'Open change' }),
      makeChange({ id: 'applied-1', title: 'Applied change', status: 'applied' }),
      makeChange({ id: 'rejected-1', title: 'Rejected change', status: 'rejected' }),
    ])))

    render(<KnowledgeReviewList slug="alice" />)

    expect(await screen.findByText('Open change')).toBeTruthy()
    expect(screen.queryByText('Applied change')).toBeNull()
    expect(screen.queryByText('Rejected change')).toBeNull()
  })
})

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeReviewList } from '@/components/workspace/knowledge-review-list'
import type { KnowledgeReviewChange } from '@/types/learning'

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

const learningResponse = (proposals: KnowledgeReviewChange[]) => ({ runs: [], proposals })

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
    const onChanged = vi.fn()

    render(<KnowledgeReviewList slug="alice" onApplied={onApplied} onChanged={onChanged} />)

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
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
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

/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeCuratorPanel } from '@/components/workspace/knowledge-curator-panel'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

const learningResponse = {
  runs: [],
  proposals: [
    {
      id: 'proposal-1',
      runId: 'run-1',
      status: 'pending',
      title: 'Remember preference',
      type: 'preference',
      confidence: 0.8,
      evidence: { quote: 'Use concise answers' },
      kbPath: 'Preferences/Answers.md',
      operation: 'update',
      proposedContent: '# Preference\n\nUse **concise** answers.',
      currentFileHash: 'hash-old',
      internalSessionId: null,
      trigger: 'agent',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
}

const runningRun = {
  id: 'run-1',
  sourceSessionId: 'session-1',
  internalSessionId: 'internal-session-1',
  title: 'Learning from session',
  trigger: 'manual',
  status: 'running',
  error: null,
  messageCount: 10,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('KnowledgeCuratorPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('surfaces proposal action errors with readable labels', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse))
      .mockResolvedValueOnce(jsonResponse({ error: 'hash_conflict' }, { status: 409 }))
      .mockResolvedValueOnce(jsonResponse(learningResponse))

    render(<KnowledgeCuratorPanel slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send to review' }))

    expect(await screen.findByText('The target file changed since this proposal was created. Review it before applying.')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })

  it('shows a readable error when loading fails on the network', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    render(<KnowledgeCuratorPanel slug="alice" />)

    expect(await screen.findByText('Could not load learning data.')).toBeTruthy()
  })

  it('disables action buttons while an action is in flight', async () => {
    let resolveAction: ((response: Response) => void) | undefined
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveAction = resolve }))
      .mockResolvedValueOnce(jsonResponse({ runs: [], proposals: [] }))

    render(<KnowledgeCuratorPanel slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send to review' }))

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Send to review' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true)
    })

    resolveAction?.(jsonResponse({ proposal: { id: 'proposal-1' } }))

    expect(await screen.findByText('No pending proposals.')).toBeTruthy()
  })

  it('renders proposal content as a markdown preview', async () => {
    fetchMock.mockResolvedValue(jsonResponse(learningResponse))

    render(<KnowledgeCuratorPanel slug="alice" />)

    expect(await screen.findByRole('heading', { name: 'Preference' })).toBeTruthy()
    expect(screen.getByText('concise')).toBeTruthy()
  })

  it('notifies the workspace after a proposal is sent to review', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse))
      .mockResolvedValueOnce(jsonResponse({ proposal: { id: 'proposal-1' } }))
      .mockResolvedValueOnce(jsonResponse({ runs: [], proposals: [] }))
    const onProposalSentToReview = vi.fn()

    render(<KnowledgeCuratorPanel slug="alice" onProposalSentToReview={onProposalSentToReview} />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send to review' }))

    await waitFor(() => expect(onProposalSentToReview).toHaveBeenCalledTimes(1))
  })

  it('refetches when refreshKey changes', async () => {
    fetchMock.mockResolvedValue(jsonResponse(learningResponse))

    const { rerender } = render(<KnowledgeCuratorPanel slug="alice" refreshKey={0} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    rerender(<KnowledgeCuratorPanel slug="alice" refreshKey={1} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('renders a collapsed rail that expands through the toggle', async () => {
    fetchMock.mockResolvedValue(jsonResponse(learningResponse))
    const onToggleCollapse = vi.fn()

    render(<KnowledgeCuratorPanel slug="alice" collapsed onToggleCollapse={onToggleCollapse} />)

    expect(screen.queryByText('Knowledge Curator')).toBeNull()
    expect(await screen.findByText('1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand curator panel' }))
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })

  it('caps the collapsed pending proposal badge at 99+', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      runs: [],
      proposals: Array.from({ length: 100 }, (_, index) => ({
        ...learningResponse.proposals[0],
        id: `proposal-${index}`,
      })),
    }))

    render(<KnowledgeCuratorPanel slug="alice" collapsed />)

    expect(await screen.findByText('99+')).toBeTruthy()
  })

  it('refreshes the pending proposal badge while collapsed', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runs: [], proposals: [] }))
      .mockResolvedValueOnce(jsonResponse(learningResponse))

    render(<KnowledgeCuratorPanel slug="alice" collapsed />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('1')).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('keeps active learning runs polling while collapsed', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(jsonResponse({ runs: [runningRun], proposals: [] }))

    render(<KnowledgeCuratorPanel slug="alice" collapsed />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('opens a learning run internal session', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [runningRun], proposals: [] }))
    const onOpenSession = vi.fn()

    render(<KnowledgeCuratorPanel slug="alice" onOpenSession={onOpenSession} />)

    expect(await screen.findByText('Learning from session')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }))

    expect(onOpenSession).toHaveBeenCalledWith('internal-session-1')
  })

  it('cancels an active learning run and refreshes the list', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runs: [runningRun], proposals: [] }))
      .mockResolvedValueOnce(jsonResponse({ run: { ...runningRun, status: 'cancelled' } }))
      .mockResolvedValueOnce(jsonResponse({ runs: [{ ...runningRun, status: 'cancelled' }], proposals: [] }))

    render(<KnowledgeCuratorPanel slug="alice" />)

    expect(await screen.findByText('Learning from session')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/learning/runs/run-1/cancel', {
        method: 'POST',
      })
    })
    expect(await screen.findByText('Cancelled')).toBeTruthy()
  })

  it('shows a readable error when cancelling a run is rejected', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ runs: [runningRun], proposals: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'run_not_cancelable' }, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ runs: [runningRun], proposals: [] }))

    render(<KnowledgeCuratorPanel slug="alice" />)

    expect(await screen.findByText('Learning from session')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('This run cannot be cancelled.')).toBeTruthy()
  })

  it('uses the simplified header with the standard collapse button', async () => {
    fetchMock.mockResolvedValue(jsonResponse(learningResponse))

    render(<KnowledgeCuratorPanel slug="alice" onToggleCollapse={vi.fn()} />)

    expect(await screen.findByText('Knowledge Curator')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse panel' })).toBeTruthy()
    expect(screen.queryByText('Review learning runs and pending KB proposals.')).toBeNull()
  })
})

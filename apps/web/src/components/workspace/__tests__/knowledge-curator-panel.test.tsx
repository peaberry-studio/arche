/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
      proposedContent: 'Use concise answers.',
      currentFileHash: 'hash-old',
      internalSessionId: null,
      trigger: 'agent',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
}

describe('KnowledgeCuratorPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('surfaces proposal action errors with readable labels', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse))
      .mockResolvedValueOnce(jsonResponse({ error: 'hash_conflict' }, { status: 409 }))
      .mockResolvedValueOnce(jsonResponse(learningResponse))

    render(<KnowledgeCuratorPanel slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

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
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true)
    })

    resolveAction?.(jsonResponse({ proposal: { id: 'proposal-1' } }))

    expect(await screen.findByText('No pending proposals.')).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: 'Expand curator panel' }))
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })
})

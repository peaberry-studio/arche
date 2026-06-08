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

  it('surfaces proposal action errors', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(learningResponse))
      .mockResolvedValueOnce(jsonResponse({ error: 'hash_conflict' }, { status: 409 }))
      .mockResolvedValueOnce(jsonResponse(learningResponse))

    render(<KnowledgeCuratorPanel slug="alice" />)

    expect(await screen.findByText('Remember preference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('hash_conflict')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })
})

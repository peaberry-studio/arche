/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PublishKbButton } from '@/components/workspace/publish-kb-button'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PublishKbButton', () => {
  it('renders disabled state with the disabled reason as title', () => {
    render(<PublishKbButton slug="alice" disabled disabledReason="Workspace is stopped" />)

    const button = screen.getByRole('button', { name: 'Publish' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('title')).toBe('Workspace is stopped')
  })

  it('publishes KB changes and calls onComplete', async () => {
    const onComplete = vi.fn()
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'published' }))

    render(<PublishKbButton slug="alice" onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await screen.findByRole('button', { name: 'Published' })
    expect(fetchMock).toHaveBeenCalledWith('/api/instances/alice/publish-kb', { method: 'POST' })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('shows no changes when there is nothing to publish', async () => {
    const onComplete = vi.fn()
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'nothing_to_publish' }))

    render(<PublishKbButton slug="alice" onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await screen.findByRole('button', { name: 'No changes' })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('shows push rejected details and dismisses the popover', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'push_rejected',
        message: 'Sync first',
        files: ['Notes/A.md', 'Notes/B.md'],
      })
    )

    render(<PublishKbButton slug="alice" />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('KB sync required')).toBeDefined()
    expect(screen.getByText('Sync first')).toBeDefined()
    expect(screen.getByText('Notes/A.md')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('KB sync required')).toBeNull())
  })

  it('shows conflict and missing remote details', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: 'conflicts', files: ['Conflict.md'] }))
      .mockResolvedValueOnce(jsonResponse({ status: 'no_remote', message: 'No origin' }))

    const { rerender } = render(<PublishKbButton slug="alice" />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('Pending conflicts')).toBeDefined()
    expect(screen.getByText('Conflict.md')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    rerender(<PublishKbButton slug="alice" />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('KB remote unavailable')).toBeDefined()
    expect(screen.getByText('No origin')).toBeDefined()
  })

  it('shows an error for HTTP and unknown failure responses', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ status: 'failed', message: 'Server rejected publish' }))

    const { rerender } = render(<PublishKbButton slug="alice" />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('Publishing failed')).toBeDefined()
    expect(screen.getByText('boom')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    rerender(<PublishKbButton slug="alice" />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('Server rejected publish')).toBeDefined()
  })
})

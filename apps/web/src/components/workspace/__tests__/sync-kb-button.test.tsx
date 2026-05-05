/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncKbButton } from '@/components/workspace/sync-kb-button'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('SyncKbButton', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders a disabled row action', () => {
    render(<SyncKbButton slug="alice" disabled renderAs="row" />)

    const button = screen.getByRole('button', { name: 'Sync knowledge base' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('syncs the KB and reports completion', async () => {
    const onComplete = vi.fn()
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 'synced' }))

    render(<SyncKbButton slug="alice" onComplete={onComplete} renderAs="row" />)
    fireEvent.click(screen.getByRole('button', { name: 'Sync knowledge base' }))

    expect(await screen.findByRole('button', { name: 'Knowledge base synced' })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/instances/alice/sync-kb', { method: 'POST' })
    expect(onComplete).toHaveBeenCalledWith('synced')
  })

  it('shows conflicts in icon mode and dismisses the popover', async () => {
    const onComplete = vi.fn()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      status: 'conflicts',
      conflicts: ['Notes/A.md', 'Notes/B.md'],
    }))

    render(<SyncKbButton slug="alice" onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button'))

    expect(await screen.findByText('Merge conflicts detected')).toBeTruthy()
    expect(screen.getByText('Resolve these files in the editor:')).toBeTruthy()
    expect(screen.getByText('Notes/A.md')).toBeTruthy()
    expect(onComplete).toHaveBeenCalledWith('conflicts')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('Merge conflicts detected')).toBeNull())
  })

  it('shows API and network errors', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'instance_not_running' }, { status: 409 }))
      .mockRejectedValueOnce(new Error('offline'))

    const { unmount } = render(<SyncKbButton slug="alice" />)
    fireEvent.click(screen.getByRole('button'))

    expect(await screen.findByText('Sync failed')).toBeTruthy()
    expect(screen.getByText('instance_not_running')).toBeTruthy()
    unmount()

    const onComplete = vi.fn()
    render(<SyncKbButton slug="alice" onComplete={onComplete} renderAs="row" />)
    fireEvent.click(screen.getByRole('button', { name: 'Sync knowledge base' }))

    expect(await screen.findByRole('button', { name: 'Sync failed' })).toBeTruthy()
    expect(onComplete).toHaveBeenCalledWith('error')
  })

  it('shows failed result messages in row mode', async () => {
    const onComplete = vi.fn()
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, status: 'no_remote', message: 'No remote configured' }))

    render(<SyncKbButton slug="alice" onComplete={onComplete} renderAs="row" />)
    fireEvent.click(screen.getByRole('button', { name: 'Sync knowledge base' }))

    expect(await screen.findByRole('button', { name: 'Sync failed' })).toBeTruthy()
    expect(onComplete).toHaveBeenCalledWith('no_remote')
  })
})

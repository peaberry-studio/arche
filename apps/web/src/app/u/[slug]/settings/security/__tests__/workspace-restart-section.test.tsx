/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceRestartSection } from '../workspace-restart-section'

describe('WorkspaceRestartSection', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('calls the restart endpoint and shows an inline error on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'restart_failed' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkspaceRestartSection slug="alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'Restart workspace' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/instances/alice/restart', {
        method: 'POST',
        cache: 'no-store',
      })
    })

    expect(await screen.findByText('Restart failed: Unable to restart the workspace.')).toBeTruthy()
  })

  it('disables the action while restarting and maps setup errors', async () => {
    let resolveResponse: (response: { json: () => Promise<{ error: string }>; ok: false }) => void = () => {}
    const responsePromise = new Promise<{ json: () => Promise<{ error: string }>; ok: false }>((resolve) => {
      resolveResponse = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(responsePromise)
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkspaceRestartSection slug="alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'Restart workspace' }))

    expect(screen.getByRole('button', { name: 'Restarting workspace...' }).getAttribute('disabled')).not.toBeNull()

    resolveResponse({
      ok: false,
      json: async () => ({ error: 'setup_required' }),
    })

    expect(await screen.findByText('Restart failed: Workspace setup is incomplete.')).toBeTruthy()
  })

  it('shows a network error when the restart request fails before a response', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkspaceRestartSection slug="alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'Restart workspace' }))

    expect(await screen.findByText('Restart failed: Network error while requesting the restart.')).toBeTruthy()
  })

  it('can render without the duplicated header block', () => {
    render(<WorkspaceRestartSection slug="alice" showHeader={false} />)

    expect(screen.queryByText('Workspace')).toBeNull()
    expect(screen.getByRole('button', { name: 'Restart workspace' })).toBeTruthy()
  })
})

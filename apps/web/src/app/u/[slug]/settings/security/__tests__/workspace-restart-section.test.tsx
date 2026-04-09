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

  it('can render without the duplicated header block', () => {
    render(<WorkspaceRestartSection slug="alice" showHeader={false} />)

    expect(screen.queryByText('Workspace')).toBeNull()
    expect(screen.getByRole('button', { name: 'Restart workspace' })).toBeTruthy()
  })
})

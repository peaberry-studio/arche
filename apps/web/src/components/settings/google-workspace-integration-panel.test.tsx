/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GoogleWorkspaceIntegrationPanel } from './google-workspace-integration-panel'

const fetchMock = vi.fn()

describe('GoogleWorkspaceIntegrationPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders loading state then populated form', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        clientId: 'test-client-id',
        configured: true,
        hasClientSecret: true,
        version: 2,
        updatedAt: '2026-04-25T10:00:00.000Z',
      }),
    })

    render(<GoogleWorkspaceIntegrationPanel slug="alice" redirectUri="https://arche.example.com/api/connectors/oauth/callback" />)

    expect(screen.getByText('Loading…')).toBeTruthy()

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).toBeNull()
    })

    expect(screen.getByDisplayValue('test-client-id')).toBeTruthy()
    expect(screen.getByText('Leave blank to preserve the existing saved secret.')).toBeTruthy()
    expect(screen.getByText('https://arche.example.com/api/connectors/oauth/callback')).toBeTruthy()
  })

  it('preserves existing secret when saving with blank secret', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clientId: 'old-client-id',
          configured: true,
          hasClientSecret: true,
          version: 1,
          updatedAt: '2026-04-25T10:00:00.000Z',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clientId: 'new-client-id',
          configured: true,
          hasClientSecret: true,
          version: 2,
          updatedAt: '2026-04-25T11:00:00.000Z',
        }),
      })

    render(<GoogleWorkspaceIntegrationPanel slug="alice" redirectUri="https://arche.example.com/api/connectors/oauth/callback" />)

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).toBeNull()
    })

    const clientIdInput = screen.getByLabelText('OAuth Client ID')
    fireEvent.change(clientIdInput, { target: { value: 'new-client-id' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Configuration saved.')).toBeTruthy()
    })

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/u/alice/google-workspace-integration',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'new-client-id', clientSecret: undefined }),
      }),
    )
  })

  it('renders error on fetch failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network failure'))

    render(<GoogleWorkspaceIntegrationPanel slug="alice" redirectUri="https://arche.example.com/api/connectors/oauth/callback" />)

    await waitFor(() => {
      expect(screen.getByText('Could not reach the server.')).toBeTruthy()
    })
  })

  it('clears credentials and resets form', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clientId: 'client-id',
          configured: true,
          hasClientSecret: true,
          version: 1,
          updatedAt: '2026-04-25T10:00:00.000Z',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clientId: null,
          configured: false,
          hasClientSecret: false,
          version: 2,
          updatedAt: '2026-04-25T11:00:00.000Z',
        }),
      })

    render(<GoogleWorkspaceIntegrationPanel slug="alice" redirectUri="https://arche.example.com/api/connectors/oauth/callback" />)

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear credentials' }))

    await waitFor(() => {
      expect(screen.getByText('Configuration saved.')).toBeTruthy()
    })

    expect(screen.queryByDisplayValue('client-id')).toBeNull()
  })
})

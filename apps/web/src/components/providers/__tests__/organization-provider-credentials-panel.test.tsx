/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notifyWorkspaceConfigChanged: vi.fn(),
}))

vi.mock('@/lib/runtime/config-status-events', () => ({
  notifyWorkspaceConfigChanged: mocks.notifyWorkspaceConfigChanged,
}))

import { OrganizationProviderCredentialsPanel } from '@/components/providers/organization-provider-credentials-panel'

describe('OrganizationProviderCredentialsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.notifyWorkspaceConfigChanged.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads organization providers and saves a missing provider key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          providers: [
            { providerId: 'openai', status: 'enabled', version: 2, lastUsedAt: '2026-05-17T10:00:00.000Z' },
            { providerId: 'anthropic', status: 'missing' },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          providers: [
            { providerId: 'openai', status: 'enabled', version: 2 },
            { providerId: 'anthropic', status: 'enabled', version: 1 },
          ],
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationProviderCredentialsPanel slug="local" />)

    expect(await screen.findByText('OpenAI')).toBeTruthy()
    expect(screen.getByText('Anthropic')).toBeTruthy()
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getByText(/Last used/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Set key' }))
    fireEvent.change(screen.getByPlaceholderText('Paste API key'), { target: { value: ' org-key ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set key' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/local/organization-providers/anthropic', {
        body: JSON.stringify({ apiKey: 'org-key' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
    })
    expect(await screen.findByText('v1')).toBeTruthy()
    expect(mocks.notifyWorkspaceConfigChanged).toHaveBeenCalledTimes(1)
  })

  it('surfaces load, save, and disable errors', async () => {
    const loadFailureFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'forbidden' }),
    })
    vi.stubGlobal('fetch', loadFailureFetch)

    const { rerender } = render(<OrganizationProviderCredentialsPanel slug="local" />)
    expect(await screen.findByText('You do not have permission for this action.')).toBeTruthy()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [{ providerId: 'openai', status: 'enabled', version: 3 }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'provider_update_failed' }),
      })
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)

    rerender(<OrganizationProviderCredentialsPanel slug="team" />)
    expect(await screen.findByText('OpenAI')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }))
    fireEvent.change(screen.getByPlaceholderText('Paste API key'), { target: { value: 'replacement' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }))
    expect(await screen.findByText('provider_update_failed')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    expect(await screen.findByText('Network error. Please try again.')).toBeTruthy()
  })
})

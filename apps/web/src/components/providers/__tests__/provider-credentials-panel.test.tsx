/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderCredentialsPanel } from '@/components/providers/provider-credentials-panel'

describe('ProviderCredentialsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads providers and saves a new provider key', async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [{ providerId: 'anthropic', status: 'missing' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [{ providerId: 'anthropic', status: 'enabled', version: 2 }] }),
      })

    vi.stubGlobal('fetch', fetchMock)

    render(<ProviderCredentialsPanel slug="local" />)

    expect(await screen.findByText('Anthropic')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    fireEvent.change(screen.getByPlaceholderText('Paste API key'), {
      target: { value: 'secret-key' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set key' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/local/providers/anthropic', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'secret-key' }),
      })
    })

    expect(await screen.findByText('Rotate key')).toBeTruthy()
  })
})

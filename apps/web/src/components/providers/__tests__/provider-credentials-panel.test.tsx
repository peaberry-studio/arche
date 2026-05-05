/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderCredentialsPanel } from '@/components/providers/provider-credentials-panel'

describe('ProviderCredentialsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
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

  it('shows load errors and hides the optional header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'forbidden' }),
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<ProviderCredentialsPanel showHeader={false} slug="local" />)

    expect(await screen.findByText('You do not have permission for this action.')).toBeTruthy()
    expect(screen.queryByText('Provider credentials')).toBeNull()
  })

  it('handles provider rotate and disable failures', async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [{ providerId: 'openai', status: 'enabled', version: 2 }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'forbidden' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'forbidden' }),
      })
      .mockRejectedValueOnce(new Error('offline'))

    vi.stubGlobal('fetch', fetchMock)

    render(<ProviderCredentialsPanel slug="local" />)

    expect(await screen.findByText('OpenAI')).toBeTruthy()
    expect(screen.getByText('v2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }))
    fireEvent.change(screen.getByPlaceholderText('Paste replacement API key'), {
      target: { value: 'replacement-key' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByPlaceholderText('Paste replacement API key')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }))
    fireEvent.change(screen.getByPlaceholderText('Paste replacement API key'), {
      target: { value: 'replacement-key' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }))

    expect(await screen.findByText('You do not have permission for this action.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    expect(await screen.findByText('You do not have permission for this action.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    expect(await screen.findByText('Network error. Please try again.')).toBeTruthy()
  })

  it('disables providers and reloads the current provider status', async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [{ providerId: 'openai', status: 'enabled' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [{ providerId: 'openai', status: 'disabled' }] }),
      })

    vi.stubGlobal('fetch', fetchMock)

    render(<ProviderCredentialsPanel slug="local" />)

    expect(await screen.findByText('OpenAI')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))

    expect(await screen.findByRole('button', { name: 'Enable' })).toBeTruthy()
  })
})

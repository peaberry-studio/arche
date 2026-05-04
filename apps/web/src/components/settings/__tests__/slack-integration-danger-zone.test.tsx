/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SlackIntegrationDangerZone } from '@/components/settings/slack-integration-danger-zone'

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

describe('SlackIntegrationDangerZone', () => {
  it('loads enabled state and disables the integration', async () => {
    const onMutated = vi.fn()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ integration: { enabled: true } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    render(<SlackIntegrationDangerZone onMutated={onMutated} slug="alice" />)

    const disableButton = await screen.findByRole('button', { name: 'Disable integration' })
    fireEvent.click(disableButton)

    await waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/u/alice/slack-integration')
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE')
    expect(screen.getByRole('button', { name: 'Integration disabled' }).hasAttribute('disabled')).toBe(true)
  })

  it('shows load and disable errors with friendly messages', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, { status: 403 }))

    const { rerender } = render(<SlackIntegrationDangerZone slug="alice" />)

    expect(await screen.findByText('Only admins can manage the Slack integration.')).toBeDefined()

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ integration: { enabled: true } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'custom_error' }, { status: 400 }))

    rerender(<SlackIntegrationDangerZone refreshVersion={1} slug="alice" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disable integration' }))

    expect(await screen.findByText('custom_error')).toBeDefined()
  })

  it('maps network errors while loading', async () => {
    fetchMock.mockRejectedValue(new Error('network'))

    render(<SlackIntegrationDangerZone slug="alice" />)

    expect(await screen.findByText('Could not reach the server.')).toBeDefined()
  })
})

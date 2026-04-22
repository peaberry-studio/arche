/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AddConnectorModal } from '@/components/connectors/add-connector-modal'

vi.mock('@/contexts/workspace-theme-context', () => ({
  useWorkspaceTheme: () => ({ themeId: 'ocean-mist', isDark: false }),
}))

describe('AddConnectorModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows Linear app actor setup instructions and saves the actor mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'conn-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const onOpenChange = vi.fn()
    const onSaved = vi.fn()

    render(
      <AddConnectorModal
        slug="alice"
        existingConnectors={[]}
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />
    )

    expect(screen.queryByText('Create a Linear OAuth application first')).toBeNull()

    fireEvent.change(screen.getByLabelText('OAuth actor'), {
      target: { value: 'app' },
    })

    expect(screen.getByText('Create a Linear OAuth application first')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create Linear OAuth application' }).getAttribute('href')).toBe(
      'https://linear.app/settings/api/applications/new'
    )
    expect(screen.getByRole('link', { name: 'Open Linear actor auth docs' }).getAttribute('href')).toBe(
      'https://linear.app/developers/oauth-actor-authorization'
    )

    expect(screen.getByRole('button', { name: 'Save connector' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('Client ID'), {
      target: { value: 'linear-client-id' },
    })
    fireEvent.change(screen.getByLabelText('Client secret'), {
      target: { value: 'linear-client-secret' },
    })

    expect(screen.getByRole('button', { name: 'Save connector' }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Save connector' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/u/alice/connectors')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      type: 'linear',
      name: 'Linear',
      config: {
        authType: 'oauth',
        oauthActor: 'app',
        oauthClientId: 'linear-client-id',
        oauthClientSecret: 'linear-client-secret',
      },
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

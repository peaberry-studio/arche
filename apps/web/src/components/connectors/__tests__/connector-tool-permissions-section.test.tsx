/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notifyWorkspaceConfigChanged: vi.fn(),
}))

vi.mock('@/lib/runtime/config-status-events', () => ({
  notifyWorkspaceConfigChanged: mocks.notifyWorkspaceConfigChanged,
}))

import { ConnectorToolPermissionsSection } from '@/components/connectors/connector-tool-permissions-section'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ConnectorToolPermissionsSection', () => {
  it('loads tools and saves changed permissions', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tools: [
            {
              name: 'search_tickets',
              title: 'Search tickets',
              description: 'Search Zendesk tickets',
              permission: 'allow',
            },
            {
              name: 'create_ticket',
              title: 'Create ticket',
              permission: 'deny',
            },
          ],
          policyConfigured: false,
          inventoryError: 'Some tool descriptions could not be loaded.',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tools: [
            {
              name: 'search_tickets',
              title: 'Search tickets',
              description: 'Search Zendesk tickets',
              permission: 'ask',
            },
            {
              name: 'create_ticket',
              title: 'Create ticket',
              permission: 'deny',
            },
          ],
          policyConfigured: true,
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<ConnectorToolPermissionsSection connectorId="conn-1" enabled slug="alice" />)

    expect(await screen.findByText('Search tickets')).toBeTruthy()
    expect(screen.getByText('Some tool descriptions could not be loaded.')).toBeTruthy()
    expect(screen.getByText('Default policy allows all connector tools.')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Ask' })[0])
    const saveButton = screen.getByRole('button', { name: 'Save tool permissions' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(false)

    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/u/alice/connectors/conn-1/tool-permissions',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          permissions: {
            search_tickets: 'ask',
            create_ticket: 'deny',
          },
        }),
      }),
    )
    expect(await screen.findByText('Custom tool policy is configured.')).toBeTruthy()
    expect(mocks.notifyWorkspaceConfigChanged).toHaveBeenCalledOnce()
  })

  it('shows load failures and disables saving', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'load_settings_failed' }),
    }))

    render(<ConnectorToolPermissionsSection connectorId="conn-1" enabled slug="alice" />)

    expect(await screen.findByText('Failed to load connector settings.')).toBeTruthy()
    expect(screen.queryByText('No MCP tools are available for this connector yet.')).toBeNull()
    expect((screen.getByRole('button', { name: 'Save tool permissions' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows network errors when loading tools fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')))

    render(<ConnectorToolPermissionsSection connectorId="conn-1" enabled slug="alice" />)

    expect(await screen.findByText('Network error. Please try again.')).toBeTruthy()
    expect(screen.queryByText('No MCP tools are available for this connector yet.')).toBeNull()
  })

  it('shows save failures without notifying config changes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tools: [
            {
              name: 'search_tickets',
              title: 'Search tickets',
              permission: 'allow',
            },
          ],
          policyConfigured: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'save_failed' }),
      })
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)

    render(<ConnectorToolPermissionsSection connectorId="conn-1" enabled slug="alice" />)

    expect(await screen.findByText('Search tickets')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save tool permissions' }))

    expect(await screen.findByText('Failed to save connector changes.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save tool permissions' }))

    expect(await screen.findByText('Network error. Please try again.')).toBeTruthy()
    expect(mocks.notifyWorkspaceConfigChanged).not.toHaveBeenCalled()
  })

  it('does not load while disabled', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<ConnectorToolPermissionsSection connectorId="conn-1" enabled={false} slug="alice" />)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('No MCP tools are available for this connector yet.')).toBeTruthy()
  })
})

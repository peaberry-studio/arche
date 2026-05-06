/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ZendeskConnectorSettingsDialog } from '@/components/connectors/zendesk-connector-settings-dialog'

function getPermissionSwitch(label: string): HTMLButtonElement {
  const labelElement = screen.getByText(label)
  const field = labelElement.parentElement?.parentElement
  const switchElement = field?.querySelector('[role="switch"]')

  if (!(switchElement instanceof HTMLButtonElement)) {
    throw new Error(`Switch not found for ${label}`)
  }

  return switchElement
}

describe('ZendeskConnectorSettingsDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('does not load settings while closed', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ZendeskConnectorSettingsDialog
        open={false}
        slug="alice"
        connectorId="conn-zendesk-1"
        connectorName="Zendesk"
        onOpenChange={vi.fn()}
      />
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Zendesk settings')).toBeNull()
  })

  it('does not submit default permissions when the initial load fails', async () => {
    let resolveFetch: ((value: { ok: boolean; json: () => Promise<null> }) => void) | undefined
    const fetchMock = vi.fn().mockReturnValueOnce(
      new Promise<{ ok: boolean; json: () => Promise<null> }>((resolve) => {
        resolveFetch = resolve
      })
    )

    vi.stubGlobal('fetch', fetchMock)

    render(
      <ZendeskConnectorSettingsDialog
        open
        slug="alice"
        connectorId="conn-zendesk-1"
        connectorName="Zendesk"
        onOpenChange={vi.fn()}
      />
    )

    expect(await screen.findByText('Loading settings...')).toBeTruthy()

    resolveFetch?.({
      ok: false,
      json: async () => null,
    })

    expect(await screen.findByText('Failed to load connector settings.')).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByText('Loading settings...')).toBeNull()
    })

    const saveButton = screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)

    for (const switchElement of screen.getAllByRole('switch')) {
      expect((switchElement as HTMLButtonElement).disabled).toBe(true)
    }

    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it('prevents enabling ticket creation without an allowed comment type', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        permissions: {
          allowRead: true,
          allowCreateTickets: false,
          allowUpdateTickets: true,
          allowPublicComments: false,
          allowInternalComments: false,
        },
      }),
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tools: [],
        policyConfigured: false,
      }),
    })

    vi.stubGlobal('fetch', fetchMock)

    render(
      <ZendeskConnectorSettingsDialog
        open
        slug="alice"
        connectorId="conn-zendesk-1"
        connectorName="Zendesk"
        onOpenChange={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    expect(screen.getByText('Enable public comments or internal notes before allowing ticket creation.')).toBeTruthy()

    const createTicketsSwitch = getPermissionSwitch('Create tickets')
    expect(createTicketsSwitch.disabled).toBe(true)

    fireEvent.click(getPermissionSwitch('Public comments'))

    expect(getPermissionSwitch('Public comments').getAttribute('aria-checked')).toBe('true')
    expect(getPermissionSwitch('Create tickets').disabled).toBe(false)

    fireEvent.click(getPermissionSwitch('Create tickets'))

    expect(getPermissionSwitch('Create tickets').getAttribute('aria-checked')).toBe('true')
    expect(getPermissionSwitch('Public comments').disabled).toBe(true)
    expect(
      screen.getByText(
        'Ticket creation needs at least one comment option. Disable ticket creation first to turn off the last enabled comment type.'
      )
    ).toBeTruthy()
  })

  it('saves loaded permissions and closes the dialog', async () => {
    const onOpenChange = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          permissions: {
            allowRead: true,
            allowCreateTickets: false,
            allowUpdateTickets: true,
            allowPublicComments: true,
            allowInternalComments: false,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tools: [],
          policyConfigured: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          permissions: {
            allowRead: false,
            allowCreateTickets: false,
            allowUpdateTickets: true,
            allowPublicComments: true,
            allowInternalComments: false,
          },
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    render(
      <ZendeskConnectorSettingsDialog
        open
        slug="alice"
        connectorId="conn-zendesk-1"
        connectorName="Zendesk"
        onOpenChange={onOpenChange}
      />
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    fireEvent.click(getPermissionSwitch('Read tickets'))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    const [, patchRequest] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(patchRequest.method).toBe('PATCH')
    expect(JSON.parse(String(patchRequest.body))).toEqual({
      permissions: {
        allowRead: false,
        allowCreateTickets: false,
        allowUpdateTickets: true,
        allowPublicComments: true,
        allowInternalComments: false,
      },
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows save errors without closing the dialog', async () => {
    const onOpenChange = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          permissions: {
            allowRead: true,
            allowCreateTickets: false,
            allowUpdateTickets: true,
            allowPublicComments: true,
            allowInternalComments: false,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tools: [],
          policyConfigured: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'save_failed' }),
      })

    vi.stubGlobal('fetch', fetchMock)

    render(
      <ZendeskConnectorSettingsDialog
        open
        slug="alice"
        connectorId="conn-zendesk-1"
        connectorName="Zendesk"
        onOpenChange={onOpenChange}
      />
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('Failed to save connector changes.')).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

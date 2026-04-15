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

  it('does not submit default permissions when the initial load fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'load_failed' }),
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

    expect(await screen.findByText('Failed to load connectors.')).toBeTruthy()

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
      expect(fetchMock).toHaveBeenCalledTimes(1)
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
})

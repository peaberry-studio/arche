/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ZendeskConnectorSettingsDialog } from '@/components/connectors/zendesk-connector-settings-dialog'
import {
  DEFAULT_ZENDESK_ACTION_PERMISSIONS,
  ZENDESK_ACTION_KEYS,
  type ZendeskActionName,
  type ZendeskActionPermissions,
  type ZendeskActionPolicy,
} from '@/lib/connectors/zendesk-types'

const mocks = vi.hoisted(() => ({
  notifyWorkspaceConfigChanged: vi.fn(),
}))

vi.mock('@/lib/runtime/config-status-events', () => ({
  notifyWorkspaceConfigChanged: mocks.notifyWorkspaceConfigChanged,
}))

function getActionButtons(label: string): HTMLButtonElement[] {
  const labelElement = screen.getByText(label)
  const field = labelElement.parentElement?.parentElement
  const buttons = Array.from(field?.querySelectorAll('button') ?? [])

  if (buttons.length !== 3) {
    throw new Error(`Policy selector not found for ${label}`)
  }

  return buttons as HTMLButtonElement[]
}

function settingsResponse(actions: ZendeskActionPermissions) {
  return {
    permissions: {},
    zendeskActionPermissions: { version: 1, actions },
  }
}

function actionsWith(overrides: Partial<Record<ZendeskActionName, ZendeskActionPolicy>>): ZendeskActionPermissions {
  return { ...DEFAULT_ZENDESK_ACTION_PERMISSIONS, ...overrides }
}

describe('ZendeskConnectorSettingsDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.notifyWorkspaceConfigChanged.mockClear()
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

    for (const selectorLabel of [
      'Search tickets',
      'Create tickets with a public comment',
    ]) {
      for (const button of getActionButtons(selectorLabel)) {
        expect(button.disabled).toBe(true)
      }
    }

    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it('renders a Deny/Ask/Allow selector for all eight actions without a generic tool section', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => settingsResponse(DEFAULT_ZENDESK_ACTION_PERMISSIONS),
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

    const labels = [
      'Search tickets',
      'Read ticket details',
      'List ticket comments',
      'Update ticket fields',
      'Create tickets with a public comment',
      'Update tickets with a public comment',
      'Create tickets with an internal note',
      'Update tickets with an internal note',
    ]
    for (const label of labels) {
      const [deny, ask, allow] = getActionButtons(label)
      expect(deny.textContent).toBe('Deny')
      expect(ask.textContent).toBe('Ask')
      expect(allow.textContent).toBe('Allow')
    }
    expect(screen.queryByText('Tool permissions')).toBeNull()
  })

  it('accepts all-denied creation actions without cross-field constraints', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => settingsResponse(DEFAULT_ZENDESK_ACTION_PERMISSIONS),
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

    fireEvent.click(getActionButtons('Create tickets with a public comment')[0])
    fireEvent.click(getActionButtons('Create tickets with an internal note')[0])
    fireEvent.click(getActionButtons('Update tickets with a public comment')[0])
    fireEvent.click(getActionButtons('Update tickets with an internal note')[0])

    const saveButton = screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(false)
    expect(screen.queryByText(/Ticket creation requires/)).toBeNull()
  })

  it('loads, edits, saves the complete canonical map, and closes the dialog', async () => {
    const onOpenChange = vi.fn()
    const loaded = actionsWith({
      create_ticket_public: 'ask',
      update_ticket_fields: 'deny',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => settingsResponse(loaded),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => settingsResponse(loaded),
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
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(getActionButtons('List ticket comments')[0])

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    const [, patchRequest] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(patchRequest.method).toBe('PATCH')
    expect(JSON.parse(String(patchRequest.body))).toEqual({
      zendeskActionPermissions: {
        version: 1,
        actions: actionsWith({
          create_ticket_public: 'ask',
          update_ticket_fields: 'deny',
          list_ticket_comments: 'deny',
        }),
      },
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mocks.notifyWorkspaceConfigChanged).toHaveBeenCalledOnce()
  })

  it('shows save errors without closing the dialog', async () => {
    const onOpenChange = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => settingsResponse(DEFAULT_ZENDESK_ACTION_PERMISSIONS),
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
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(getActionButtons('Search tickets')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('Failed to save connector changes.')).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mocks.notifyWorkspaceConfigChanged).not.toHaveBeenCalled()
  })

  it('preserves loaded policies across every action when saving unchanged state', async () => {
    const onOpenChange = vi.fn()
    const loaded = actionsWith(
      Object.fromEntries(ZENDESK_ACTION_KEYS.map((key, index) => [key, (['deny', 'ask', 'allow'] as const)[index % 3]])) as
        Partial<Record<ZendeskActionName, ZendeskActionPolicy>>
    )
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => settingsResponse(loaded),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => settingsResponse(loaded),
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
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    for (const [action, policy] of Object.entries(loaded)) {
      const policyIndex = policy === 'deny' ? 0 : policy === 'ask' ? 1 : 2
      const buttons = getActionButtons(
        {
          search_tickets: 'Search tickets',
          get_ticket: 'Read ticket details',
          list_ticket_comments: 'List ticket comments',
          create_ticket_public: 'Create tickets with a public comment',
          create_ticket_internal: 'Create tickets with an internal note',
          update_ticket_fields: 'Update ticket fields',
          update_ticket_with_public_comment: 'Update tickets with a public comment',
          update_ticket_with_internal_note: 'Update tickets with an internal note',
        }[action as ZendeskActionName]
      )
      expect(buttons[policyIndex].className).toContain('bg-primary')
    }

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    const [, patchRequest] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(patchRequest.body))).toEqual({
      zendeskActionPermissions: { version: 1, actions: loaded },
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

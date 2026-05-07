/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectorsPanel } from '@/components/connectors/connectors-panel'
import type { ConnectorListItem, ConnectorTestState } from '@/components/connectors/types'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
const mockNotifyWorkspaceConfigChanged = vi.fn()

type MockConnectorListProps = {
  busyConnectorIds: Record<string, boolean>
  connectors: ConnectorListItem[]
  loadError: string | null
  onConnectOAuth: (id: string) => void
  onCreateFirst: () => void
  onDelete: (id: string, name: string) => void
  onOpenSettings: (connector: ConnectorListItem) => void
  onRetry: () => void
  onTestConnection: (id: string) => void
  onToggleEnabled: (id: string, enabled: boolean) => void
  testStates: Record<string, ConnectorTestState>
}

vi.mock('@/lib/runtime/config-status-events', () => ({
  notifyWorkspaceConfigChanged: () => mockNotifyWorkspaceConfigChanged(),
}))

vi.mock('@/components/connectors/connector-list', () => ({
  ConnectorList: ({
    busyConnectorIds,
    connectors,
    loadError,
    onConnectOAuth,
    onCreateFirst,
    onDelete,
    onOpenSettings,
    onRetry,
    onTestConnection,
    onToggleEnabled,
    testStates,
  }: MockConnectorListProps) => (
    <div data-testid="connector-list">
      <p>count:{connectors.length}</p>
      {loadError ? <p>load:{loadError}</p> : null}
      <button type="button" onClick={onRetry}>Retry load</button>
      <button type="button" onClick={onCreateFirst}>Create first</button>
      {connectors.map((connector) => (
        <section key={connector.id}>
          <p>{connector.name}:{connector.enabled ? 'enabled' : 'disabled'}</p>
          <p>{busyConnectorIds[connector.id] ? 'busy' : 'idle'}</p>
          <p>{testStates[connector.id]?.message ?? 'untested'}</p>
          <button type="button" onClick={() => onToggleEnabled(connector.id, connector.enabled)}>Toggle {connector.name}</button>
          <button type="button" onClick={() => onTestConnection(connector.id)}>Test {connector.name}</button>
          <button type="button" onClick={() => onConnectOAuth(connector.id)}>OAuth {connector.name}</button>
          <button type="button" onClick={() => onOpenSettings(connector)}>Settings {connector.name}</button>
          <button type="button" onClick={() => onDelete(connector.id, connector.name)}>Delete {connector.name}</button>
        </section>
      ))}
    </div>
  ),
}))

vi.mock('@/components/connectors/add-connector-modal', () => ({
  AddConnectorModal: ({ open, onSaved }: { onSaved: () => void; open: boolean }) => (
    <div data-testid="add-modal">
      {open ? 'open' : 'closed'}
      <button type="button" onClick={onSaved}>Save connector</button>
    </div>
  ),
}))

vi.mock('@/components/connectors/zendesk-connector-settings-dialog', () => ({
  ZendeskConnectorSettingsDialog: ({ connectorName, onOpenChange, open }: { connectorName: string | null; onOpenChange: (open: boolean) => void; open: boolean }) => open ? (
    <div>
      Zendesk settings {connectorName}
      <button type="button" onClick={() => onOpenChange(false)}>Close Zendesk settings</button>
    </div>
  ) : null,
}))

vi.mock('@/components/connectors/meta-ads-connector-settings-dialog', () => ({
  MetaAdsConnectorSettingsDialog: ({ connectorName, onOpenChange, open }: { connectorName: string | null; onOpenChange: (open: boolean) => void; open: boolean }) => open ? (
    <div>
      Meta settings {connectorName}
      <button type="button" onClick={() => onOpenChange(false)}>Close Meta settings</button>
    </div>
  ) : null,
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function connector(overrides: Partial<ConnectorListItem> = {}): ConnectorListItem {
  return {
    authType: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    enabled: true,
    id: 'zendesk-1',
    name: 'Zendesk',
    oauthConnected: false,
    status: 'ready',
    type: 'zendesk',
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  mockNotifyWorkspaceConfigChanged.mockReset()
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ConnectorsPanel', () => {
  it('loads connectors and handles successful connector actions', async () => {
    const connectors = [connector(), connector({ id: 'meta-1', name: 'Meta Ads', type: 'meta-ads' })]
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/u/alice/connectors' && !init?.method) return jsonResponse({ connectors })
      if (url.endsWith('/zendesk-1') && init?.method === 'PATCH') return jsonResponse({ enabled: false })
      if (url.endsWith('/zendesk-1/test')) return jsonResponse({ ok: true, tested: true, message: 'Verified' })
      if (url.endsWith('/zendesk-1') && init?.method === 'DELETE') return jsonResponse({ ok: true })
      return jsonResponse({ authorizeUrl: 'https://auth.example/start' }, { status: 400 })
    })

    render(<ConnectorsPanel oauthReturnTo="/u/alice/connectors" slug="alice" />)

    expect(await screen.findByText('count:2')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Settings Zendesk' }))
    expect(screen.getByText('Zendesk settings Zendesk')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Close Zendesk settings' }))
    expect(screen.queryByText('Zendesk settings Zendesk')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Settings Meta Ads' }))
    expect(screen.getByText('Meta settings Meta Ads')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Close Meta settings' }))
    expect(screen.queryByText('Meta settings Meta Ads')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Zendesk' }))
    await waitFor(() => expect(screen.getByText('Zendesk:disabled')).toBeDefined())
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/zendesk-1') && init?.method === 'PATCH')?.[1]?.body))).toEqual({ enabled: false })

    fireEvent.click(screen.getByRole('button', { name: 'Test Zendesk' }))
    expect(await screen.findByText('Verified')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Zendesk' }))
    await waitFor(() => expect(screen.getByText('count:1')).toBeDefined())
    expect(mockNotifyWorkspaceConfigChanged).toHaveBeenCalledTimes(2)
  })

  it('shows load and action errors and opens the add modal', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'load_failed' }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ connectors: [connector()] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'delete_failed' }, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ connectors: [connector()] }))

    render(<ConnectorsPanel slug="alice" />)

    expect(await screen.findByText('load:Failed to load connectors.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Retry load' }))
    expect(await screen.findByText('count:1')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Zendesk' }))
    expect(await screen.findByText('The action could not be completed: Failed to delete connector.')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Create first' }))
    expect(screen.getByTestId('add-modal').textContent).toContain('open')
    fireEvent.click(screen.getByRole('button', { name: 'Save connector' }))
    await waitFor(() => expect(mockNotifyWorkspaceConfigChanged).toHaveBeenCalledTimes(1))
  })

  it('handles oauth callback state from the URL', async () => {
    window.history.pushState({}, '', '/u/alice/connectors?oauth=error&message=access_denied')
    fetchMock.mockResolvedValue(jsonResponse({ error: 'load_failed' }, { status: 500 }))

    render(<ConnectorsPanel slug="alice" />)

    expect(await screen.findByText('The action could not be completed: Authorization was denied by the provider.')).toBeDefined()
    expect(window.location.search).toBe('')
  })

  it('handles successful oauth callback state and oauth start', async () => {
    window.history.pushState({}, '', '/u/alice/connectors?oauth=success')
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ connectors: [connector({ authType: 'oauth', id: 'linear-1', name: 'Linear', type: 'linear' })] }))
      .mockResolvedValueOnce(jsonResponse({ connectors: [connector({ authType: 'oauth', id: 'linear-1', name: 'Linear', type: 'linear' })] }))
      .mockResolvedValueOnce(jsonResponse({ authorizeUrl: '#oauth-start' }))

    render(<ConnectorsPanel slug="alice" />)

    expect(await screen.findByText('count:1')).toBeDefined()
    expect(window.location.search).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'OAuth Linear' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/connectors/linear-1/oauth/start', expect.objectContaining({ method: 'POST' }))
    })
  })

  it('handles connector mutation, test, and oauth failures', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ connectors: [connector()] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'update_failed' }, { status: 400 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse({ error: 'test_failed' }, { status: 500 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse({ error: 'oauth_start_failed' }, { status: 400 }))
      .mockRejectedValueOnce(new Error('offline'))

    render(<ConnectorsPanel oauthReturnTo="/u/alice/connectors" slug="alice" />)

    expect(await screen.findByText('count:1')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Zendesk' }))
    expect(await screen.findByText('The action could not be completed: Failed to update connector.')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Zendesk' }))
    expect(await screen.findByText('The action could not be completed: Network error. Please try again.')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Test Zendesk' }))
    expect(await screen.findByText('Connection test failed.')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Test Zendesk' }))
    expect(await screen.findByText('Network error. Please try again.')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'OAuth Zendesk' }))
    expect(await screen.findByText('The action could not be completed: Unable to start OAuth authentication.')).toBeDefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/u/alice/connectors/zendesk-1/oauth/start?returnTo=%2Fu%2Falice%2Fconnectors', expect.objectContaining({ method: 'POST' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete Zendesk' }))
    expect(await screen.findByText('The action could not be completed: Network error. Please try again.')).toBeDefined()
  })

  it('opens generic tool settings for connectors without a dedicated settings dialog', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        connectors: [connector({ id: 'linear-1', name: 'Linear', type: 'linear' })],
      }))
      .mockResolvedValueOnce(jsonResponse({
        tools: [],
        policyConfigured: false,
      }))

    render(<ConnectorsPanel slug="alice" />)

    expect(await screen.findByText('count:1')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Settings Linear' }))

    expect(await screen.findByText('Connector settings')).toBeDefined()
    expect(screen.getByText('No MCP tools are available for this connector yet.')).toBeDefined()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/u/alice/connectors/linear-1/tool-permissions', {
      cache: 'no-store',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('Connector settings')).toBeNull())
  })
})

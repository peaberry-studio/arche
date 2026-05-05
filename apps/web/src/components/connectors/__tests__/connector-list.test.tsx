/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectorList } from '@/components/connectors/connector-list'
import type { ConnectorListItem, ConnectorTestState } from '@/components/connectors/types'

type MockConnectorCardProps = {
  connector: ConnectorListItem
  isBusy: boolean
  onConnectOAuth: (id: string) => void
  onDelete: (id: string, name: string) => void
  onOpenSettings: (connector: ConnectorListItem) => void
  onTestConnection: (id: string) => void
  onToggleEnabled: (id: string, enabled: boolean) => void
  testState?: ConnectorTestState
}

vi.mock('@/components/connectors/connector-card', () => ({
  ConnectorCard: ({
    connector,
    isBusy,
    onConnectOAuth,
    onDelete,
    onOpenSettings,
    onTestConnection,
    onToggleEnabled,
    testState,
  }: MockConnectorCardProps) => (
    <section data-testid={`connector-${connector.id}`}>
      <p>{connector.name}</p>
      <p>{isBusy ? 'busy' : 'idle'}</p>
      <p>{testState?.message ?? 'untested'}</p>
      <button type="button" onClick={() => onToggleEnabled(connector.id, connector.enabled)}>
        Toggle {connector.name}
      </button>
      <button type="button" onClick={() => onTestConnection(connector.id)}>
        Test {connector.name}
      </button>
      <button type="button" onClick={() => onConnectOAuth(connector.id)}>
        OAuth {connector.name}
      </button>
      <button type="button" onClick={() => onOpenSettings(connector)}>
        Settings {connector.name}
      </button>
      <button type="button" onClick={() => onDelete(connector.id, connector.name)}>
        Delete {connector.name}
      </button>
    </section>
  ),
}))

afterEach(() => {
  cleanup()
})

function makeConnector(overrides: Partial<ConnectorListItem> = {}): ConnectorListItem {
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

const handlers = {
  onConnectOAuth: vi.fn(),
  onCreateFirst: vi.fn(),
  onDelete: vi.fn(),
  onOpenSettings: vi.fn(),
  onRetry: vi.fn(),
  onTestConnection: vi.fn(),
  onToggleEnabled: vi.fn(),
}

function renderList(props: Partial<Parameters<typeof ConnectorList>[0]> = {}) {
  return render(
    <ConnectorList
      busyConnectorIds={{}}
      connectors={[]}
      isLoading={false}
      loadError={null}
      testStates={{}}
      {...handlers}
      {...props}
    />
  )
}

describe('ConnectorList', () => {
  it('renders loading, error, and empty states', () => {
    const { container, rerender } = renderList({ isLoading: true })

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)

    rerender(
      <ConnectorList
        busyConnectorIds={{}}
        connectors={[]}
        isLoading={false}
        loadError="boom"
        testStates={{}}
        {...handlers}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('Failed to load connectors: boom')).toBeDefined()
    expect(handlers.onRetry).toHaveBeenCalledTimes(1)

    rerender(
      <ConnectorList
        busyConnectorIds={{}}
        connectors={[]}
        isLoading={false}
        loadError={null}
        testStates={{}}
        {...handlers}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add your first connector' }))
    expect(screen.getByText('No connectors configured')).toBeDefined()
    expect(handlers.onCreateFirst).toHaveBeenCalledTimes(1)
  })

  it('passes connector state and actions to connector cards', () => {
    const connector = makeConnector()
    renderList({
      busyConnectorIds: { 'zendesk-1': true },
      connectors: [connector],
      testStates: { 'zendesk-1': { status: 'success', message: 'ok' } },
    })

    expect(screen.getByTestId('connector-zendesk-1')).toBeDefined()
    expect(screen.getByText('busy')).toBeDefined()
    expect(screen.getByText('ok')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Zendesk' }))
    fireEvent.click(screen.getByRole('button', { name: 'Test Zendesk' }))
    fireEvent.click(screen.getByRole('button', { name: 'OAuth Zendesk' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings Zendesk' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Zendesk' }))

    expect(handlers.onToggleEnabled).toHaveBeenCalledWith('zendesk-1', true)
    expect(handlers.onTestConnection).toHaveBeenCalledWith('zendesk-1')
    expect(handlers.onConnectOAuth).toHaveBeenCalledWith('zendesk-1')
    expect(handlers.onOpenSettings).toHaveBeenCalledWith(connector)
    expect(handlers.onDelete).toHaveBeenCalledWith('zendesk-1', 'Zendesk')
  })
})

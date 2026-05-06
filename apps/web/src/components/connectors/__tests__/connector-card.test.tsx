/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectorCard } from '@/components/connectors/connector-card'
import type { ConnectorListItem } from '@/components/connectors/types'

const baseConnector: ConnectorListItem = {
  id: 'conn-1',
  type: 'zendesk',
  name: 'Zendesk Support',
  enabled: true,
  status: 'ready',
  authType: 'manual',
  oauthConnected: false,
  createdAt: '2026-01-01T00:00:00.000Z',
}

afterEach(() => {
  cleanup()
})

describe('ConnectorCard', () => {
  it('renders connector status, settings action, and successful test result', () => {
    render(
      <ConnectorCard
        connector={baseConnector}
        testState={{ status: 'success', message: 'Connected' }}
        isBusy={false}
        onDelete={vi.fn()}
        onOpenSettings={vi.fn()}
        onToggleEnabled={vi.fn()}
        onTestConnection={vi.fn()}
        onConnectOAuth={vi.fn()}
      />
    )

    expect(screen.getByText('Zendesk Support')).toBeDefined()
    expect(screen.getByText('Working')).toBeDefined()
    expect(screen.getByText('Test: Connected')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined()
  })

  it('toggles enabled state and starts connection tests', () => {
    const onToggleEnabled = vi.fn()
    const onTestConnection = vi.fn()
    render(
      <ConnectorCard
        connector={baseConnector}
        isBusy={false}
        onDelete={vi.fn()}
        onOpenSettings={vi.fn()}
        onToggleEnabled={onToggleEnabled}
        onTestConnection={onTestConnection}
        onConnectOAuth={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(onToggleEnabled).toHaveBeenCalledWith('conn-1', true)
    expect(onTestConnection).toHaveBeenCalledWith('conn-1')
  })

  it('handles OAuth connectors and pending status', () => {
    const onConnectOAuth = vi.fn()
    render(
      <ConnectorCard
        connector={{
          ...baseConnector,
          type: 'linear',
          status: 'pending',
          authType: 'oauth',
          oauthConnected: false,
        }}
        isBusy={false}
        onDelete={vi.fn()}
        onOpenSettings={vi.fn()}
        onToggleEnabled={vi.fn()}
        onTestConnection={vi.fn()}
        onConnectOAuth={onConnectOAuth}
      />
    )

    expect(screen.getByText('Pending setup')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Test connection' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Connect OAuth' }))
    expect(onConnectOAuth).toHaveBeenCalledWith('conn-1')
  })

  it('opens settings for configurable connectors', () => {
    const onOpenSettings = vi.fn()
    render(
      <ConnectorCard
        connector={{ ...baseConnector, type: 'meta-ads', name: 'Meta Ads' }}
        isBusy={false}
        onDelete={vi.fn()}
        onOpenSettings={onOpenSettings}
        onToggleEnabled={vi.fn()}
        onTestConnection={vi.fn()}
        onConnectOAuth={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onOpenSettings).toHaveBeenCalledWith({ ...baseConnector, type: 'meta-ads', name: 'Meta Ads' })
  })

  it('confirms, cancels, and closes connector deletion', () => {
    const onDelete = vi.fn()
    const { container } = render(
      <ConnectorCard
        connector={baseConnector}
        isBusy={false}
        onDelete={onDelete}
        onOpenSettings={vi.fn()}
        onToggleEnabled={vi.fn()}
        onTestConnection={vi.fn()}
        onConnectOAuth={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete connector' }))
    expect(screen.getByText('Delete this connector?')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete this connector?')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete connector' }))
    fireEvent.mouseDown(container)
    expect(screen.queryByText('Delete this connector?')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete connector' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith('conn-1', 'Zendesk Support')
  })
})

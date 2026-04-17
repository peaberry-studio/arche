/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreatePersonalAccessToken = vi.fn()
const mockRevokePersonalAccessToken = vi.fn()
const mockSetMcpEnabled = vi.fn()
const mockExecCommand = vi.fn()

vi.mock('../actions', () => ({
  createPersonalAccessToken: (input: unknown) => mockCreatePersonalAccessToken(input),
  revokePersonalAccessToken: (tokenId: string) => mockRevokePersonalAccessToken(tokenId),
  setMcpEnabled: (enabled: boolean) => mockSetMcpEnabled(enabled),
}))

import { McpSettingsPanel } from '../mcp-settings-panel'

describe('McpSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: mockExecCommand,
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    mockExecCommand.mockReturnValue(true)
    mockCreatePersonalAccessToken.mockResolvedValue({
      ok: true,
      token: 'arche_pat_123',
      tokenRecord: {
        id: 'tok-1',
        name: 'MacBook Pro - Codex',
        scopes: ['agents:read'],
        createdAt: '2026-04-12T10:00:00.000Z',
        expiresAt: '2026-05-12T10:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  function getScopeCheckbox(name: string): HTMLInputElement {
    return screen.getByRole('checkbox', { name: new RegExp(name, 'i') }) as HTMLInputElement
  }

  function openCreateDialog() {
    fireEvent.click(screen.getByRole('button', { name: /new token/i }))
  }

  it('submits the selected MCP scopes when creating a token', async () => {
    render(
      <McpSettingsPanel
        mcpEnabled={true}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="https://arche.example.com"
        personalAccessTokens={[]}
      />,
    )

    openCreateDialog()

    fireEvent.change(screen.getByLabelText('Token name'), {
      target: { value: 'MacBook Pro - Codex' },
    })

    fireEvent.click(getScopeCheckbox('Knowledge base read'))
    fireEvent.click(getScopeCheckbox('Knowledge base write'))
    fireEvent.click(getScopeCheckbox('Tasks run'))
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))

    await waitFor(() => {
      expect(mockCreatePersonalAccessToken).toHaveBeenCalledWith({
        expiresInDays: 30,
        name: 'MacBook Pro - Codex',
        scopes: ['agents:read'],
      })
    })
  })

  it('disables token creation when no MCP permissions are selected', () => {
    render(
      <McpSettingsPanel
        mcpEnabled={true}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="https://arche.example.com"
        personalAccessTokens={[]}
      />,
    )

    openCreateDialog()

    fireEvent.click(getScopeCheckbox('Knowledge base read'))
    fireEvent.click(getScopeCheckbox('Knowledge base write'))
    fireEvent.click(getScopeCheckbox('Agents read'))
    fireEvent.click(getScopeCheckbox('Tasks run'))

    expect((screen.getByRole('button', { name: 'Create token' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides the New token button and explains MCP is off for admins when disabled', () => {
    render(
      <McpSettingsPanel
        mcpEnabled={false}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="https://arche.example.com"
        personalAccessTokens={[]}
      />,
    )

    expect(screen.getByText('MCP access is off')).toBeTruthy()
    expect(screen.getByText('Enable MCP endpoint access before creating tokens.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /new token/i })).toBeNull()
  })

  it('tells non-admin users to contact their administrator when MCP is off', () => {
    render(
      <McpSettingsPanel
        mcpEnabled={false}
        mcpConfigError={null}
        canManageMcp={false}
        mcpBaseUrl="https://arche.example.com"
        personalAccessTokens={[]}
      />,
    )

    expect(screen.getByText(/ask your workspace administrator/i)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('exposes the admin toggle only when the user can manage MCP', () => {
    const { unmount } = render(
      <McpSettingsPanel
        mcpEnabled={true}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="https://arche.example.com"
        personalAccessTokens={[]}
      />,
    )

    expect(screen.getByRole('switch')).toBeTruthy()
    unmount()

    render(
      <McpSettingsPanel
        mcpEnabled={true}
        mcpConfigError={null}
        canManageMcp={false}
        mcpBaseUrl="https://arche.example.com"
        personalAccessTokens={[]}
      />,
    )

    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('renders token creation buttons with pointer cursor', () => {
    render(
      <McpSettingsPanel
        mcpEnabled={true}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="https://arche.example.com"
        personalAccessTokens={[]}
      />,
    )

    const newTokenButton = screen.getByRole('button', { name: /new token/i })
    expect(newTokenButton.className.includes('cursor-pointer')).toBe(true)

    openCreateDialog()

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    const createTokenButton = screen.getByRole('button', { name: 'Create token' })
    const expires30DaysButton = screen.getByRole('button', { name: '30 days' })

    expect(cancelButton.className.includes('cursor-pointer')).toBe(true)
    expect(createTokenButton.className.includes('cursor-pointer')).toBe(true)
    expect(expires30DaysButton.className.includes('cursor-pointer')).toBe(true)
  })

  it('shows add-server commands in the success step after token creation', async () => {
    render(
      <McpSettingsPanel
        mcpEnabled={true}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="http://arche.lvh.me:8080"
        personalAccessTokens={[]}
      />,
    )

    openCreateDialog()

    fireEvent.change(screen.getByLabelText('Token name'), {
      target: { value: 'MacBook Pro - Codex' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))

    expect(await screen.findByText('Quick connect')).toBeTruthy()
    expect(screen.getByText(/claude mcp add-json arche/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }))

    expect(screen.getByText(/export ARCHE_MCP_TOKEN='arche_pat_123'/i)).toBeTruthy()
    expect(screen.getByText(/codex mcp add arche --url 'http:\/\/arche\.lvh\.me:8080\/api\/mcp'/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Config' }))

    expect(screen.getByText(/"mcpServers"/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy config' })).toBeTruthy()
  })

  it('falls back to document.execCommand when navigator.clipboard is unavailable', async () => {
    render(
      <McpSettingsPanel
        mcpEnabled={true}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="http://arche.lvh.me:8080"
        personalAccessTokens={[]}
      />,
    )

    openCreateDialog()

    fireEvent.change(screen.getByLabelText('Token name'), {
      target: { value: 'MacBook Pro - Codex' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))

    const copyButton = await screen.findByRole('button', { name: 'Copy command' })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(mockExecCommand).toHaveBeenCalledWith('copy')
    })
    expect(screen.queryByText(/clipboard access is not available/i)).toBeNull()
  })

  it('renders token timestamps in a deterministic UTC format', () => {
    render(
      <McpSettingsPanel
        mcpEnabled={true}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="http://arche.lvh.me:8080"
        personalAccessTokens={[
          {
            id: 'tok-2',
            name: 'Existing token',
            scopes: ['kb:read'],
            createdAt: '2026-04-12T10:33:07.000Z',
            expiresAt: '2026-05-12T10:33:07.000Z',
            lastUsedAt: '2026-04-12T21:33:00.000Z',
            revokedAt: null,
          },
        ]}
      />,
    )

    expect(screen.getByText('Created April 12, 2026 · Expires May 12, 2026')).toBeTruthy()
    expect(screen.getByText('Last used Apr 12, 2026, 9:33 PM UTC')).toBeTruthy()
  })

  it('hides already revoked tokens from the existing tokens list', () => {
    render(
      <McpSettingsPanel
        mcpEnabled={true}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="http://arche.lvh.me:8080"
        personalAccessTokens={[
          {
            id: 'tok-active',
            name: 'Active token',
            scopes: ['kb:read'],
            createdAt: '2026-04-12T10:33:07.000Z',
            expiresAt: '2026-05-12T10:33:07.000Z',
            lastUsedAt: null,
            revokedAt: null,
          },
          {
            id: 'tok-revoked',
            name: 'Revoked token',
            scopes: ['kb:read'],
            createdAt: '2026-04-12T10:33:07.000Z',
            expiresAt: '2026-05-12T10:33:07.000Z',
            lastUsedAt: null,
            revokedAt: '2026-04-13T10:33:07.000Z',
          },
        ]}
      />,
    )

    expect(screen.getByText('Active token')).toBeTruthy()
    expect(screen.queryByText('Revoked token')).toBeNull()
  })

  it('opens a confirmation dialog before revoking a token', async () => {
    render(
      <McpSettingsPanel
        mcpEnabled={true}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="http://arche.lvh.me:8080"
        personalAccessTokens={[
          {
            id: 'tok-2',
            name: 'Existing token',
            scopes: ['kb:read'],
            createdAt: '2026-04-12T10:33:07.000Z',
            expiresAt: '2026-05-12T10:33:07.000Z',
            lastUsedAt: null,
            revokedAt: null,
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    expect(screen.getByRole('heading', { name: 'Revoke token?' })).toBeTruthy()
    expect(screen.getByText(/revoke "Existing token"\?/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(mockRevokePersonalAccessToken).not.toHaveBeenCalled()
    })
    expect(screen.getByText('Existing token')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Revoke token?' })).toBeNull()
  })

  it('removes a token from the list after a confirmed revoke', async () => {
    mockRevokePersonalAccessToken.mockResolvedValue({ ok: true })

    render(
      <McpSettingsPanel
        mcpEnabled={true}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="http://arche.lvh.me:8080"
        personalAccessTokens={[
          {
            id: 'tok-2',
            name: 'Existing token',
            scopes: ['kb:read'],
            createdAt: '2026-04-12T10:33:07.000Z',
            expiresAt: '2026-05-12T10:33:07.000Z',
            lastUsedAt: null,
            revokedAt: null,
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke token' }))

    await waitFor(() => {
      expect(mockRevokePersonalAccessToken).toHaveBeenCalledWith('tok-2')
    })
    expect(screen.queryByText('Existing token')).toBeNull()
    expect(screen.getByText('No tokens created yet.')).toBeTruthy()
  })
})

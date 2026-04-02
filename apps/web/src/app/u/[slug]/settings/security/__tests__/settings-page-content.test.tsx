/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SecuritySettingsPanel } from '../settings-page-content'

vi.mock('@/components/totp-setup-wizard', () => ({
  TotpSetupWizard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../change-password-form', () => ({
  ChangePasswordForm: () => <div>Change password form</div>,
}))

vi.mock('../mcp-settings-panel', () => ({
  McpSettingsPanel: () => <div>MCP settings panel</div>,
}))

describe('SecuritySettingsPanel', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders password and 2FA controls when available', () => {
    render(
      <SecuritySettingsPanel
        passwordChangeEnabled={true}
        twoFactorEnabled={true}
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy()
    expect(screen.getByText('Change password form')).toBeTruthy()
    expect(screen.getByText('Two-factor authentication')).toBeTruthy()
    expect(screen.getByText('Set up 2FA')).toBeTruthy()
  })

  it('omits change-password and 2FA blocks when unavailable', () => {
    render(
      <SecuritySettingsPanel
        passwordChangeEnabled={false}
        twoFactorEnabled={false}
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
        mcpAvailable={false}
        mcpEnabled={false}
        mcpConfigError={null}
        canManageMcp={false}
        mcpBaseUrl="https://arche.example.com"
        personalAccessTokens={[]}
      />,
    )

    expect(screen.queryByRole('heading', { name: 'Change password' })).toBeNull()
    expect(screen.queryByText('Two-factor authentication')).toBeNull()
    expect(screen.queryByText('MCP settings panel')).toBeNull()
  })

  it('renders MCP panel when mcpAvailable is true', () => {
    render(
      <SecuritySettingsPanel
        passwordChangeEnabled={true}
        twoFactorEnabled={true}
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
        mcpAvailable={true}
        mcpEnabled={false}
        mcpConfigError={null}
        canManageMcp={true}
        mcpBaseUrl="https://arche.example.com"
        personalAccessTokens={[]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy()
    expect(screen.getByText('Two-factor authentication')).toBeTruthy()
    expect(screen.getByText('Set up 2FA')).toBeTruthy()
    expect(screen.getByText('MCP settings panel')).toBeTruthy()
  })
})

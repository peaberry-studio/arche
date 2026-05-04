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
      />,
    )

    expect(screen.queryByRole('heading', { name: 'Change password' })).toBeNull()
    expect(screen.queryByText('Two-factor authentication')).toBeNull()
  })

  it('renders enabled 2FA status with management actions', () => {
    render(
      <SecuritySettingsPanel
        passwordChangeEnabled={false}
        twoFactorEnabled={true}
        enabled={true}
        verifiedAt={new Date('2026-04-20T10:00:00.000Z')}
        recoveryCodesRemaining={3}
      />,
    )

    expect(screen.getByText('Enabled')).toBeTruthy()
    expect(screen.getByText('Enabled on April 20, 2026')).toBeTruthy()
    expect(screen.getByText('Recovery codes remaining:')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Regenerate codes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Disable 2FA' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Set up 2FA' })).toBeNull()
  })
})

/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsPageContent } from '../settings-page-content'

vi.mock('@/components/dashboard/theme-picker', () => ({
  ThemePicker: () => <div>Theme picker</div>,
}))

vi.mock('@/components/totp-setup-wizard', () => ({
  TotpSetupWizard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('SettingsPageContent', () => {
  afterEach(() => {
    cleanup()
  })

  it('omits the two-factor section in desktop mode', () => {
    render(
      <SettingsPageContent
        passwordChangeEnabled={false}
        twoFactorEnabled={false}
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
        releaseVersion="03"
      />,
    )

    expect(screen.getByText('Appearance')).toBeTruthy()
    expect(screen.queryByText('Change password')).toBeNull()
    expect(screen.queryByText('Two-factor authentication')).toBeNull()
    expect(screen.queryByText('Set up 2FA')).toBeNull()
    expect(screen.getByText(/Peaberry Studio/)).toBeTruthy()
    expect(screen.getByText(/Arche 03/)).toBeTruthy()
  })

  it('renders the two-factor section in web mode', () => {
    render(
      <SettingsPageContent
        passwordChangeEnabled={true}
        twoFactorEnabled
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
        releaseVersion="03"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy()
    expect(screen.getByText('Two-factor authentication')).toBeTruthy()
    expect(screen.getByText('Set up 2FA')).toBeTruthy()
  })
})

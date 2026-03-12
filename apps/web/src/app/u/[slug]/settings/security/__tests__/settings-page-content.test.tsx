/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SettingsPageContent } from '../settings-page-content'

vi.mock('@/components/dashboard/theme-picker', () => ({
  ThemePicker: () => <div>Theme picker</div>,
}))

vi.mock('@/components/totp-setup-wizard', () => ({
  TotpSetupWizard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('SettingsPageContent', () => {
  it('omits the two-factor section in desktop mode', () => {
    render(
      <SettingsPageContent
        twoFactorEnabled={false}
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
      />,
    )

    expect(screen.getByText('Appearance')).toBeTruthy()
    expect(screen.queryByText('Two-factor authentication')).toBeNull()
    expect(screen.queryByText('Set up 2FA')).toBeNull()
  })

  it('renders the two-factor section in web mode', () => {
    render(
      <SettingsPageContent
        twoFactorEnabled
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
      />,
    )

    expect(screen.getByText('Two-factor authentication')).toBeTruthy()
    expect(screen.getByText('Set up 2FA')).toBeTruthy()
  })
})

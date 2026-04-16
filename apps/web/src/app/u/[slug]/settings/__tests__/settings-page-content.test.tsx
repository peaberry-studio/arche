/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsPageContent } from '../settings-page-content'

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('@/components/dashboard/theme-picker', () => ({
  ThemePicker: () => <div>Theme picker</div>,
}))

vi.mock('@/components/settings/slack-integration-panel', () => ({
  SlackIntegrationPanel: ({ slug }: { slug: string }) => <div>Slack panel {slug}</div>,
}))

vi.mock('@/components/settings/advanced-settings-panel', () => ({
  AdvancedSettingsPanel: ({ slug }: { slug: string }) => <div>Advanced panel {slug}</div>,
}))

vi.mock('../security/settings-page-content', () => ({
  SecuritySettingsPanel: () => <div>Security panel</div>,
}))

describe('SettingsPageContent', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the sidebar and integration section links', () => {
    render(
      <SettingsPageContent
        slug="alice"
        availableSections={['appearance', 'integrations', 'security', 'advanced']}
        currentSection="integrations"
        passwordChangeEnabled={true}
        twoFactorEnabled={true}
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
        releaseVersion="03"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Look & Feel' }).getAttribute('href')).toBe('/u/alice/settings')
    expect(screen.getByRole('link', { name: 'Security' }).getAttribute('href')).toBe('/u/alice/settings?section=security')
    expect(screen.getByText('Slack panel alice')).toBeTruthy()
    expect(screen.getByText(/Arche 03/)).toBeTruthy()
  })

  it('hides unavailable sections and renders look and feel by default', () => {
    render(
      <SettingsPageContent
        slug="alice"
        availableSections={['appearance', 'security', 'advanced']}
        currentSection="appearance"
        passwordChangeEnabled={true}
        twoFactorEnabled={true}
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
        releaseVersion="03"
      />,
    )

    expect(screen.queryByRole('link', { name: 'Integrations' })).toBeNull()
    expect(screen.getByText('Theme picker')).toBeTruthy()
    expect(screen.queryByText('Slack panel alice')).toBeNull()
  })
})

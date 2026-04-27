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

vi.mock('../security/workspace-restart-section', () => ({
  WorkspaceRestartSection: ({ slug }: { slug: string }) => <div>Workspace restart {slug}</div>,
}))

vi.mock('../security/settings-page-content', () => ({
  SecuritySettingsPanel: () => <div>Security panel</div>,
}))

vi.mock('@/components/settings/settings-logout-button', () => ({
  SettingsLogoutButton: () => <button type="button">Log out</button>,
}))

vi.mock('@/components/settings/google-workspace-integration-summary-card', () => ({
  GoogleWorkspaceIntegrationSummaryCard: ({ integration }: { integration: { configured: boolean } }) => (
    <div>Google Workspace integration {integration.configured ? 'Configured' : 'Not configured'}</div>
  ),
}))

describe('SettingsPageContent', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the sidebar and integration section links', () => {
    render(
      <SettingsPageContent
        slug="alice"
        availableSections={['general', 'integrations', 'security']}
        currentSection="integrations"
        passwordChangeEnabled={true}
        twoFactorEnabled={true}
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
        releaseVersion="03"
        slackIntegrationSummary={{
          configured: true,
          defaultAgentId: null,
          enabled: true,
          hasAppToken: true,
          hasBotToken: true,
          lastError: null,
          lastEventAt: '2026-04-16T20:00:00.000Z',
          lastSocketConnectedAt: '2026-04-16T19:00:00.000Z',
          resolvedDefaultAgentId: null,
          slackAppId: 'A123',
          slackBotUserId: 'U123',
          slackTeamId: 'T123',
          status: 'connected',
          updatedAt: '2026-04-16T20:00:00.000Z',
          version: 3,
        }}
        googleWorkspaceSummary={{
          clientId: 'g-id',
          configured: true,
          hasClientSecret: true,
          version: 1,
          updatedAt: '2026-04-25T10:00:00.000Z',
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'General' }).getAttribute('href')).toBe('/u/alice/settings')
    expect(screen.getByRole('link', { name: 'Security' }).getAttribute('href')).toBe('/u/alice/settings?section=security')
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy()
    expect(screen.getByText('Slack integration')).toBeTruthy()
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Setup' }).getAttribute('href')).toBe('/u/alice/settings/integrations/slack')
    expect(screen.getByText('Google Workspace integration Configured')).toBeTruthy()
    expect(screen.getByText(/Arche 03/)).toBeTruthy()
  })

  it('hides unavailable sections and renders general by default with theme and restart', () => {
    render(
      <SettingsPageContent
        slug="alice"
        availableSections={['general', 'security']}
        currentSection="general"
        passwordChangeEnabled={true}
        twoFactorEnabled={true}
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
        releaseVersion="03"
        slackIntegrationSummary={null}
        googleWorkspaceSummary={null}
      />,
    )

    expect(screen.queryByRole('link', { name: 'Integrations' })).toBeNull()
    expect(screen.getByText('Theme picker')).toBeTruthy()
    expect(screen.getByText('Workspace restart alice')).toBeTruthy()
    expect(screen.queryByText('Slack integration')).toBeNull()
    expect(screen.queryByText('Google Workspace integration')).toBeNull()
  })

  it('shows Google Workspace card when Slack is unavailable', () => {
    render(
      <SettingsPageContent
        slug="alice"
        availableSections={['general', 'integrations', 'security']}
        currentSection="integrations"
        passwordChangeEnabled={true}
        twoFactorEnabled={true}
        enabled={false}
        verifiedAt={null}
        recoveryCodesRemaining={0}
        releaseVersion="03"
        slackIntegrationSummary={null}
        googleWorkspaceSummary={{
          clientId: 'g-id',
          configured: true,
          hasClientSecret: true,
          version: 1,
          updatedAt: '2026-04-25T10:00:00.000Z',
        }}
      />,
    )

    expect(screen.getByRole('link', { name: 'Integrations' })).toBeTruthy()
    expect(screen.queryByText('Slack integration')).toBeNull()
    expect(screen.getByText('Google Workspace integration Configured')).toBeTruthy()
  })
})

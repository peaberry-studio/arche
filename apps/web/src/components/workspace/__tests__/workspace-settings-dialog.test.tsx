/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceSettingsDialog } from '@/components/workspace/workspace-settings-dialog'
import type { KbGithubRemoteIntegrationSummary } from '@/lib/kb-github-remote/types'
import type { RuntimeCapabilities } from '@/lib/runtime/capabilities'
import type { SlackIntegrationSummary } from '@/lib/slack/types'

const slackSummaryFixture: SlackIntegrationSummary = {
  enabled: true,
  status: 'connected',
  configured: true,
  hasBotToken: true,
  hasAppToken: true,
  slackTeamId: 'T1',
  slackAppId: 'A1',
  slackBotUserId: 'U1',
  defaultAgentId: null,
  resolvedDefaultAgentId: null,
  lastError: null,
  lastSocketConnectedAt: null,
  lastEventAt: null,
  version: 1,
  updatedAt: null,
}

const kbGithubRemoteSummaryFixture: KbGithubRemoteIntegrationSummary = {
  appConfigured: true,
  appId: 'A1',
  appSlug: 'arche-kb',
  hasPrivateKey: true,
  installationAccount: 'acme',
  installationId: 1,
  lastError: null,
  lastSyncAt: null,
  lastSyncStatus: 'success',
  ready: true,
  repoDefaultBranch: 'main',
  repoFullName: 'acme/kb',
  updatedAt: null,
  version: 1,
}

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/w/alice',
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.search,
}))

const caps: RuntimeCapabilities = {
  multiUser: true,
  auth: true,
  containers: true,
  workspaceAgent: true,
  reaper: true,
  csrf: true,
  twoFactor: true,
  teamManagement: true,
  connectors: true,
  kickstart: true,
  flows: true,
  slackIntegration: true,
  googleWorkspaceIntegration: true,
  kbGithubRemoteIntegration: true,
  metaAdsConnector: true,
}

vi.mock('@/components/connectors/connectors-manager', () => ({
  ConnectorsManager: ({ title }: { title?: string }) => <div data-testid="connectors-manager">{title}</div>,
}))

vi.mock('@/components/team/team-page-client', () => ({
  TeamPageClient: () => <div data-testid="team-page-client">Team</div>,
}))

vi.mock('@/components/providers/organization-provider-credentials-panel', () => ({
  OrganizationProviderCredentialsPanel: () => <div data-testid="org-providers">Org providers</div>,
}))

vi.mock('@/components/providers/provider-credentials-panel', () => ({
  ProviderCredentialsPanel: () => <div data-testid="providers-panel">Providers</div>,
}))

vi.mock('@/components/providers/usage-analytics-panel', () => ({
  UsageAnalyticsPanel: () => <div data-testid="usage-analytics-panel">Analytics</div>,
}))

vi.mock('@/components/dashboard/theme-picker', () => ({
  ThemePicker: () => <div data-testid="theme-picker">Theme picker</div>,
}))

vi.mock('@/components/settings/security-settings-panel', () => ({
  SecuritySettingsPanel: () => <div data-testid="security-settings-panel">Security</div>,
}))

vi.mock('@/components/settings/workspace-restart-section', () => ({
  WorkspaceRestartSection: () => <div data-testid="workspace-restart-section">Restart</div>,
}))

vi.mock('@/components/settings/settings-logout-button', () => ({
  SettingsLogoutButton: () => <div data-testid="settings-logout-button">Log out</div>,
}))

vi.mock('@/components/settings/slack-integration-summary-card', () => ({
  SlackIntegrationSummaryCard: () => <div data-testid="slack-summary">Slack</div>,
}))

vi.mock('@/components/settings/google-workspace-integration-summary-card', () => ({
  GoogleWorkspaceIntegrationSummaryCard: () => <div data-testid="google-summary">Google</div>,
}))

vi.mock('@/components/settings/kb-github-remote-summary-card', () => ({
  KbGithubRemoteSummaryCard: () => <div data-testid="kb-github-summary">GitHub</div>,
}))

vi.mock('@/components/mcp/mcp-integration-summary-card', () => ({
  McpIntegrationSummaryCard: () => <div data-testid="mcp-summary">MCP</div>,
}))

vi.mock('@/components/settings/slack-integration-panel', () => ({
  SlackIntegrationPanel: () => <div data-testid="slack-integration-panel">Slack panel</div>,
}))

vi.mock('@/components/settings/slack-integration-settings-content', () => ({
  SlackIntegrationSettingsContent: ({ showProviderCredentials }: { showProviderCredentials: boolean }) => (
    <div data-testid="slack-integration-settings-content" data-show-provider-credentials={String(showProviderCredentials)}>
      Slack settings content
    </div>
  ),
}))

vi.mock('@/components/settings/google-workspace-integration-panel', () => ({
  GoogleWorkspaceIntegrationPanel: () => <div data-testid="google-workspace-integration-panel">Google panel</div>,
}))

vi.mock('@/components/settings/kb-github-remote-panel', () => ({
  KbGithubRemotePanel: () => <div data-testid="kb-github-remote-panel">GitHub panel</div>,
}))

vi.mock('@/components/mcp/mcp-settings-panel', () => ({
  McpSettingsPanel: () => <div data-testid="mcp-settings-panel">MCP panel</div>,
}))

function renderDialog(overrides: Partial<Parameters<typeof WorkspaceSettingsDialog>[0]> = {}) {
  return render(
    <WorkspaceSettingsDialog
      slug="alice"
      caps={caps}
      isAdmin
      currentUserId="user-1"
      currentUserEmail="alice@example.com"
      currentUserSlug="alice"
      googleWorkspaceRedirectUri="http://localhost:3000/api/connectors/oauth/callback"
      passwordChangeEnabled
      twoFactorEnabled
      twoFactorEnabledStatus
      recoveryCodesRemaining={5}
      twoFactorVerifiedAt={null}
      slackIntegrationSummary={null}
      slackServiceUserAvailable
      googleWorkspaceSummary={null}
      kbGithubRemoteSummary={null}
      {...overrides}
    />,
  )
}

describe('WorkspaceSettingsDialog', () => {
  beforeEach(() => {
    navigation.replace.mockReset()
    navigation.search = new URLSearchParams()
  })

  afterEach(() => {
    cleanup()
  })

  it('is closed when no settings param is present', () => {
    renderDialog()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens from a settings query param and renders the matching section', () => {
    navigation.search = new URLSearchParams('settings=connectors')

    renderDialog()

    expect(screen.getByTestId('connectors-manager')).toBeTruthy()
  })

  it('renders general by default with the theme picker and restart section', () => {
    navigation.search = new URLSearchParams('settings=general')

    renderDialog()

    expect(screen.getByTestId('theme-picker')).toBeTruthy()
    expect(screen.getByTestId('workspace-restart-section')).toBeTruthy()
  })

  it('renders the integrations summary list', () => {
    navigation.search = new URLSearchParams('settings=integrations')

    renderDialog({
      slackIntegrationSummary: slackSummaryFixture,
      googleWorkspaceSummary: { clientId: 'c', configured: true, hasClientSecret: true, version: 1, updatedAt: null },
      kbGithubRemoteSummary: kbGithubRemoteSummaryFixture,
    })

    expect(screen.getByTestId('slack-summary')).toBeTruthy()
    expect(screen.getByTestId('google-summary')).toBeTruthy()
    expect(screen.getByTestId('kb-github-summary')).toBeTruthy()
    expect(screen.getByTestId('mcp-summary')).toBeTruthy()
  })

  it('renders team and security sections', () => {
    navigation.search = new URLSearchParams('settings=team')
    const { unmount } = renderDialog()
    expect(screen.getByTestId('team-page-client')).toBeTruthy()
    unmount()

    navigation.search = new URLSearchParams('settings=security')
    renderDialog()
    expect(screen.getByTestId('security-settings-panel')).toBeTruthy()
  })

  it('renders nested integration panels from the integration query param', () => {
    navigation.search = new URLSearchParams('settings=integrations&integration=slack')
    const first = renderDialog()
    expect(screen.getByTestId('slack-integration-settings-content')).toBeTruthy()
    first.unmount()

    navigation.search = new URLSearchParams('settings=integrations&integration=mcp')
    const second = renderDialog()
    expect(screen.getByTestId('mcp-settings-panel')).toBeTruthy()
    second.unmount()

    navigation.search = new URLSearchParams('settings=integrations&integration=google-workspace')
    const third = renderDialog()
    expect(screen.getByTestId('google-workspace-integration-panel')).toBeTruthy()
    third.unmount()

    navigation.search = new URLSearchParams('settings=integrations&integration=kb-github-remote')
    renderDialog({
      kbGithubRemoteSummary: kbGithubRemoteSummaryFixture,
    })
    expect(screen.getByTestId('kb-github-remote-panel')).toBeTruthy()
  })

  it('renders the Slack bot configuration with provider credentials when the service user is available', () => {
    navigation.search = new URLSearchParams('settings=integrations&integration=slack')

    renderDialog({ slackServiceUserAvailable: true })

    const content = screen.getByTestId('slack-integration-settings-content')
    expect(content.getAttribute('data-show-provider-credentials')).toBe('true')
  })

  it('hides the Slack bot provider credentials when the service user is unavailable', () => {
    navigation.search = new URLSearchParams('settings=integrations&integration=slack')

    renderDialog({ slackServiceUserAvailable: false })

    const content = screen.getByTestId('slack-integration-settings-content')
    expect(content.getAttribute('data-show-provider-credentials')).toBe('false')
  })

  it('mounts the log out action in the settings sidebar', () => {
    navigation.search = new URLSearchParams('settings=general')

    renderDialog()

    expect(screen.getByTestId('settings-logout-button')).toBeTruthy()
  })

  it('filters sections by capabilities', () => {
    const limitedCaps: RuntimeCapabilities = { ...caps, connectors: false, teamManagement: false, slackIntegration: false, googleWorkspaceIntegration: false, kbGithubRemoteIntegration: false }
    navigation.search = new URLSearchParams('settings=general')

    renderDialog({ caps: limitedCaps })

    expect(screen.queryByRole('button', { name: 'Connectors' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Team' })).toBeNull()
  })

  it('closes by removing the settings param', () => {
    navigation.search = new URLSearchParams('settings=general&session=session-1')

    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))

    expect(navigation.replace).toHaveBeenCalledWith('/w/alice?session=session-1')
  })

  it('switches sections by updating the settings param', () => {
    navigation.search = new URLSearchParams('settings=general')

    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Security' }))

    expect(navigation.replace).toHaveBeenCalledWith('/w/alice?settings=security')
  })
})

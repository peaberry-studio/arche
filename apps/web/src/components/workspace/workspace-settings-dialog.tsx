'use client'

import { useCallback, useMemo } from 'react'
import { ArrowLeft, X } from '@phosphor-icons/react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { ConnectorsManager } from '@/components/connectors/connectors-manager'
import { ThemePicker } from '@/components/dashboard/theme-picker'
import { McpIntegrationSummaryCard } from '@/components/mcp/mcp-integration-summary-card'
import { McpSettingsPanel } from '@/components/mcp/mcp-settings-panel'
import { OrganizationProviderCredentialsPanel } from '@/components/providers/organization-provider-credentials-panel'
import { ProviderCredentialsPanel } from '@/components/providers/provider-credentials-panel'
import { UsageAnalyticsPanel } from '@/components/providers/usage-analytics-panel'
import { GoogleWorkspaceIntegrationPanel } from '@/components/settings/google-workspace-integration-panel'
import { GoogleWorkspaceIntegrationSummaryCard } from '@/components/settings/google-workspace-integration-summary-card'
import { KbGithubRemotePanel } from '@/components/settings/kb-github-remote-panel'
import { KbGithubRemoteSummaryCard } from '@/components/settings/kb-github-remote-summary-card'
import { SecuritySettingsPanel } from '@/components/settings/security-settings-panel'
import { SettingsLogoutButton } from '@/components/settings/settings-logout-button'
import { SettingsSection } from '@/components/settings/settings-section'
import { SlackIntegrationSettingsContent } from '@/components/settings/slack-integration-settings-content'
import { SlackIntegrationSummaryCard } from '@/components/settings/slack-integration-summary-card'
import { WorkspaceRestartSection } from '@/components/settings/workspace-restart-section'
import { TeamPageClient } from '@/components/team/team-page-client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import type { GoogleWorkspaceIntegrationSummary } from '@/lib/google-workspace/types'
import type { KbGithubRemoteIntegrationSummary } from '@/lib/kb-github-remote/types'
import type { RuntimeCapabilities } from '@/lib/runtime/capabilities'
import type { SlackIntegrationSummary } from '@/lib/slack/types'
import { cn } from '@/lib/utils'
import {
  isWorkspaceSettingsSection,
  type WorkspaceSettingsSection,
} from '@/lib/workspace-settings'

type WorkspaceSettingsDialogProps = {
  caps: RuntimeCapabilities
  currentUserEmail: string
  currentUserId: string
  currentUserSlug: string
  googleWorkspaceRedirectUri: string
  googleWorkspaceSummary: GoogleWorkspaceIntegrationSummary | null
  isAdmin: boolean
  kbGithubRemoteSummary: KbGithubRemoteIntegrationSummary | null
  passwordChangeEnabled: boolean
  recoveryCodesRemaining: number
  slackServiceUserAvailable: boolean
  slug: string
  slackIntegrationSummary: SlackIntegrationSummary | null
  twoFactorEnabled: boolean
  twoFactorEnabledStatus: boolean
  twoFactorVerifiedAt: Date | null
}

const SECTION_LABELS: Record<string, string> = {
  general: 'General',
  providers: 'Providers',
  connectors: 'Connectors',
  team: 'Team',
  integrations: 'Integrations',
  security: 'Security',
  analytics: 'Analytics',
}

export function WorkspaceSettingsDialog({
  caps,
  currentUserEmail,
  currentUserId,
  currentUserSlug,
  googleWorkspaceRedirectUri,
  googleWorkspaceSummary,
  isAdmin,
  kbGithubRemoteSummary,
  passwordChangeEnabled,
  recoveryCodesRemaining,
  slackServiceUserAvailable,
  slackIntegrationSummary,
  slug,
  twoFactorEnabled,
  twoFactorEnabledStatus,
  twoFactorVerifiedAt,
}: WorkspaceSettingsDialogProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const settingsParam = searchParams.get('settings')
  const requestedSection = isWorkspaceSettingsSection(settingsParam) ? settingsParam : null
  const availableSections: WorkspaceSettingsSection[] = useMemo(() => {
    const sections: WorkspaceSettingsSection[] = ['general', 'providers']
    if (caps.connectors) sections.push('connectors')
    if (caps.teamManagement) sections.push('team')
    if (
      caps.slackIntegration ||
      caps.googleWorkspaceIntegration ||
      caps.kbGithubRemoteIntegration ||
      caps.connectors
    ) {
      sections.push('integrations')
    }
    if (passwordChangeEnabled || twoFactorEnabled) sections.push('security')
    if (isAdmin) sections.push('analytics')
    return sections
  }, [caps, isAdmin, passwordChangeEnabled, twoFactorEnabled])

  // Unavailable sections are ignored and fall back to the first available
  // one, mirroring the legacy server-rendered settings page.
  const section: WorkspaceSettingsSection | null = requestedSection
    ? (availableSections.includes(requestedSection) ? requestedSection : availableSections[0])
    : null
  const integrationId = searchParams.get('integration')

  const update = useCallback(
    (updater: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      updater(params)
      const next = params.toString()
      router.replace(next ? `${pathname}?${next}` : pathname)
    },
    [pathname, router, searchParams],
  )

  const close = useCallback(() => {
    update((params) => {
      params.delete('settings')
      params.delete('integration')
      params.delete('oauth')
      params.delete('message')
    })
  }, [update])

  const selectSection = useCallback(
    (next: WorkspaceSettingsSection) => {
      update((params) => {
        params.set('settings', next)
        params.delete('integration')
      })
    },
    [update],
  )

  function renderIntegrations() {
    const back = (
      <button
        type="button"
        onClick={() => update((params) => params.delete('integration'))}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} weight="bold" />
        Back to integrations
      </button>
    )

    if (integrationId === 'slack' && isAdmin) {
      return (
        <div className="space-y-4">
          {back}
          <SlackIntegrationSettingsContent
            serviceUserSlug="slack-bot"
            slug={slug}
            showProviderCredentials={slackServiceUserAvailable}
          />
        </div>
      )
    }
    if (integrationId === 'google-workspace' && isAdmin) {
      return (
        <div className="space-y-4">
          {back}
          <GoogleWorkspaceIntegrationPanel slug={slug} redirectUri={googleWorkspaceRedirectUri} />
        </div>
      )
    }
    if (integrationId === 'kb-github-remote' && kbGithubRemoteSummary) {
      return (
        <div className="space-y-4">
          {back}
          <KbGithubRemotePanel slug={slug} initialIntegration={kbGithubRemoteSummary} />
        </div>
      )
    }
    if (integrationId === 'mcp') {
      return (
        <div className="space-y-4">
          {back}
          <McpSettingsPanel
            currentUserEmail={currentUserEmail}
            currentUserId={currentUserId}
            currentUserSlug={currentUserSlug}
            isAdmin={isAdmin}
          />
        </div>
      )
    }

    return (
      <div className="space-y-5">
        {slackIntegrationSummary ? (
          <SlackIntegrationSummaryCard slug={slug} integration={slackIntegrationSummary} />
        ) : null}
        {googleWorkspaceSummary ? (
          <GoogleWorkspaceIntegrationSummaryCard slug={slug} integration={googleWorkspaceSummary} />
        ) : null}
        {kbGithubRemoteSummary ? (
          <KbGithubRemoteSummaryCard slug={slug} integration={kbGithubRemoteSummary} />
        ) : null}
        <McpIntegrationSummaryCard slug={slug} />
      </div>
    )
  }

  function renderSection(current: WorkspaceSettingsSection | null) {
    switch (current) {
      case 'general':
        return (
          <div className="space-y-6">
            <SettingsSection
              title="Look & Feel"
              description="Customize the theme for this workspace."
            >
              <ThemePicker />
            </SettingsSection>
            <SettingsSection
              title="Workspace restart"
              description="Force a full restart of the local workspace runtime when connector or provider changes require a rebuild."
            >
              <WorkspaceRestartSection slug={slug} showHeader={false} />
            </SettingsSection>
          </div>
        )
      case 'providers':
        return (
          <SettingsSection
            title={isAdmin ? 'Global Organization-wide Providers' : 'Providers'}
            description="Set deployment-wide AI provider credentials inherited by users without overrides. Existing keys are never displayed."
          >
            {isAdmin ? (
              <OrganizationProviderCredentialsPanel slug={slug} />
            ) : (
              <ProviderCredentialsPanel slug={slug} />
            )}
          </SettingsSection>
        )
      case 'connectors':
        return (
          <ConnectorsManager
            slug={slug}
            embedded
            title="Connectors"
            description="Manage workspace integrations without leaving the workspace."
          />
        )
      case 'team':
        return (
          <TeamPageClient
            slug={slug}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            canManageUsers={caps.teamManagement}
            embedded
          />
        )
      case 'integrations':
        return renderIntegrations()
      case 'security':
        return (
          <SecuritySettingsPanel
            passwordChangeEnabled={passwordChangeEnabled}
            twoFactorEnabled={twoFactorEnabled}
            enabled={twoFactorEnabledStatus}
            verifiedAt={twoFactorVerifiedAt}
            recoveryCodesRemaining={recoveryCodesRemaining}
          />
        )
      case 'analytics':
        return (
          <SettingsSection
            title="Usage & Analytics"
            description="Track provider requests, errors, runs, tokens, costs, sessions, and audit activity. Prompts and responses are not captured."
          >
            <UsageAnalyticsPanel slug={slug} />
          </SettingsSection>
        )
      default:
        return null
    }
  }

  const activeSection = section ?? null

  return (
    <Dialog open={Boolean(section)} onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className="left-0 top-0 h-[100dvh] w-screen max-h-[100dvh] max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0 sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-6xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:border">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure general, providers, connectors, team, integrations, security, and analytics settings.
        </DialogDescription>

        <div className="flex h-full flex-col sm:h-[min(80vh,54rem)]">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-6">
            <p className="text-base font-semibold leading-none tracking-tight text-foreground">Settings</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={close}
              aria-label="Close settings"
            >
              <X size={16} weight="bold" />
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="flex shrink-0 flex-col border-b border-border/60 bg-muted/20 p-3 md:border-b-0 md:border-r md:p-4">
              <nav className="flex gap-1 overflow-x-auto scrollbar-custom md:flex-1 md:flex-col md:space-y-1 md:overflow-visible">
                {availableSections.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => selectSection(candidate)}
                    className={cn(
                      'flex shrink-0 items-center rounded-xl px-3 py-2 text-left text-sm transition-colors md:w-full',
                      activeSection === candidate
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-background hover:text-foreground',
                    )}
                    aria-pressed={activeSection === candidate}
                  >
                    {SECTION_LABELS[candidate]}
                  </button>
                ))}
              </nav>
              <div className="mt-3 border-t border-border/60 pt-2">
                <SettingsLogoutButton />
              </div>
            </aside>

            <div className="scrollbar-custom min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {renderSection(activeSection)}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

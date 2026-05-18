import Link from 'next/link'

import { ThemePicker } from '@/components/dashboard/theme-picker'
import { OrganizationProviderCredentialsPanel } from '@/components/providers/organization-provider-credentials-panel'
import { UsageAnalyticsPanel } from '@/components/providers/usage-analytics-panel'
import { GoogleWorkspaceIntegrationSummaryCard } from '@/components/settings/google-workspace-integration-summary-card'
import { KbGithubRemoteSummaryCard } from '@/components/settings/kb-github-remote-summary-card'
import { SettingsLogoutButton } from '@/components/settings/settings-logout-button'
import { SettingsSection } from '@/components/settings/settings-section'
import { SlackIntegrationSummaryCard } from '@/components/settings/slack-integration-summary-card'
import { TeamPageClient } from '@/components/team/team-page-client'
import type { GoogleWorkspaceIntegrationSummary } from '@/lib/google-workspace/types'
import type { KbGithubRemoteIntegrationSummary } from '@/lib/kb-github-remote/types'
import type { SlackIntegrationSummary } from '@/lib/slack/types'
import { cn } from '@/lib/utils'
import { WorkspaceRestartSection } from './security/workspace-restart-section'
import { SecuritySettingsPanel } from './security/settings-page-content'
import {
  SETTINGS_SECTION_LABELS,
  type SettingsSection as SettingsSectionName,
} from './sections'

type SettingsPageContentProps = {
  slug: string
  availableSections: SettingsSectionName[]
  currentSection: SettingsSectionName
  isAdmin: boolean
  currentUserId: string
  canManageUsers: boolean
  passwordChangeEnabled: boolean
  twoFactorEnabled: boolean
  enabled: boolean
  verifiedAt: Date | null
  recoveryCodesRemaining: number
  releaseVersion: string
  slackIntegrationSummary: SlackIntegrationSummary | null
  googleWorkspaceSummary: GoogleWorkspaceIntegrationSummary | null
  kbGithubRemoteSummary?: KbGithubRemoteIntegrationSummary | null
}

export function SettingsPageContent({
  slug,
  availableSections,
  currentSection,
  isAdmin,
  currentUserId,
  canManageUsers,
  passwordChangeEnabled,
  twoFactorEnabled,
  enabled,
  verifiedAt,
  recoveryCodesRemaining,
  releaseVersion,
  slackIntegrationSummary,
  googleWorkspaceSummary,
  kbGithubRemoteSummary,
}: SettingsPageContentProps) {
  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="space-y-2">
        <h1 className="type-display text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your workspace preferences, integrations, and account security.
        </p>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-10 lg:self-start">
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
              {availableSections.map((section) => (
                <Link
                  key={section}
                  href={getSettingsSectionHref(slug, section, availableSections[0])}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm transition-colors',
                    currentSection === section
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-background hover:text-foreground',
                  )}
                >
                  {SETTINGS_SECTION_LABELS[section]}
                </Link>
              ))}
            </nav>
            <div className="mt-3 border-t border-border/60 pt-3">
              <SettingsLogoutButton />
            </div>
          </div>
        </aside>

        <div className="min-w-0">{renderSection()}</div>
      </div>

      <p className="pt-8 text-center text-[11px] tracking-wide text-muted-foreground/50">
        Peaberry Studio · Arche {releaseVersion}
      </p>
    </main>
  )

  function renderSection() {
    switch (currentSection) {
      case 'general':
        return (
          <div className="space-y-6">
            <SettingsSection
              title="Look & Feel"
              description="Customize the dashboard theme for this workspace."
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
      case 'integrations':
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
          </div>
        )
      case 'providers':
        return (
          <SettingsSection
            title="Global Organization-wide Providers"
            description="Set deployment-wide AI provider credentials inherited by users without overrides. Existing keys are never displayed."
          >
            <OrganizationProviderCredentialsPanel slug={slug} />
          </SettingsSection>
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
      case 'team':
        return (
          <TeamPageClient
            slug={slug}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            canManageUsers={canManageUsers}
            embedded
          />
        )
      case 'security':
        return (
          <SecuritySettingsPanel
            passwordChangeEnabled={passwordChangeEnabled}
            twoFactorEnabled={twoFactorEnabled}
            enabled={enabled}
            verifiedAt={verifiedAt}
            recoveryCodesRemaining={recoveryCodesRemaining}
          />
        )
    }
  }
}

function getSettingsSectionHref(
  slug: string,
  section: SettingsSectionName,
  defaultSection: SettingsSectionName | undefined,
): string {
  if (section === defaultSection) {
    return `/u/${slug}/settings`
  }

  return `/u/${slug}/settings?section=${section}`
}

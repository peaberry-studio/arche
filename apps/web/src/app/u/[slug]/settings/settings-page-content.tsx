import Link from 'next/link'

import { ThemePicker } from '@/components/dashboard/theme-picker'
import { AdvancedSettingsPanel } from '@/components/settings/advanced-settings-panel'
import { SlackIntegrationPanel } from '@/components/settings/slack-integration-panel'
import { cn } from '@/lib/utils'
import { SecuritySettingsPanel } from './security/settings-page-content'
import {
  SETTINGS_SECTION_LABELS,
  type SettingsSection,
} from './sections'

type SettingsPageContentProps = {
  slug: string
  availableSections: SettingsSection[]
  currentSection: SettingsSection
  passwordChangeEnabled: boolean
  twoFactorEnabled: boolean
  enabled: boolean
  verifiedAt: Date | null
  recoveryCodesRemaining: number
  releaseVersion: string
}

export function SettingsPageContent({
  slug,
  availableSections,
  currentSection,
  passwordChangeEnabled,
  twoFactorEnabled,
  enabled,
  verifiedAt,
  recoveryCodesRemaining,
  releaseVersion,
}: SettingsPageContentProps) {
  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div>
        <h1 className="type-display text-3xl font-semibold tracking-tight">Settings</h1>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <p className="pb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Sections
            </p>

            <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
              {availableSections.map((section) => (
                <Link
                  key={section}
                  href={getSettingsSectionHref(slug, section, availableSections[0])}
                  className={cn(
                    'rounded-xl px-3 py-2 text-sm transition-colors',
                    currentSection === section
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-background hover:text-foreground',
                  )}
                >
                  {SETTINGS_SECTION_LABELS[section]}
                </Link>
              ))}
            </nav>
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
      case 'appearance':
        return (
          <section className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-6">
            <div className="space-y-1">
              <h2 className="text-lg font-medium">Look &amp; Feel</h2>
              <p className="text-sm text-muted-foreground">
                Customize the dashboard theme for this workspace.
              </p>
            </div>

            <ThemePicker />
          </section>
        )
      case 'integrations':
        return (
          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-lg font-medium">Integrations</h2>
              <p className="text-sm text-muted-foreground">
                Manage admin-controlled integrations that connect Arche with external tools.
              </p>
            </div>

            <SlackIntegrationPanel slug={slug} />
          </section>
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
      case 'advanced':
        return <AdvancedSettingsPanel slug={slug} />
    }
  }
}

function getSettingsSectionHref(
  slug: string,
  section: SettingsSection,
  defaultSection: SettingsSection | undefined,
): string {
  if (section === defaultSection) {
    return `/u/${slug}/settings`
  }

  return `/u/${slug}/settings?section=${section}`
}

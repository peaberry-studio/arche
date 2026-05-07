'use client'

import { useCallback } from 'react'
import { X } from '@phosphor-icons/react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { ConnectorsManager } from '@/components/connectors/connectors-manager'
import { ProviderCredentialsPanel } from '@/components/providers/provider-credentials-panel'
import { AdvancedSettingsPanel } from '@/components/settings/advanced-settings-panel'
import { AgentsSettingsPanel } from '@/components/settings/agents-settings-panel'
import { AppearanceSettingsPanel } from '@/components/settings/appearance-settings-panel'
import { SkillsSettingsPanel } from '@/components/settings/skills-settings-panel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DESKTOP_SETTINGS_SECTIONS,
  type DesktopSettingsSection,
} from '@/lib/runtime/desktop/current-vault'
import { cn } from '@/lib/utils'

type DesktopSettingsDialogProps = {
  slug: string
  currentSection: DesktopSettingsSection | null
}

const SECTION_LABELS: Record<DesktopSettingsSection, string> = {
  providers: 'Providers',
  connectors: 'Connectors',
  agents: 'Agents',
  skills: 'Skills',
  appearance: 'Appearance',
  advanced: 'Advanced',
}

export function DesktopSettingsDialog({ slug, currentSection }: DesktopSettingsDialogProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  const updateSection = useCallback(
    (section: DesktopSettingsSection | null) => {
      const params = new URLSearchParams(searchParams.toString())

      if (section) {
        params.set('settings', section)
      } else {
        params.delete('settings')
        params.delete('oauth')
        params.delete('message')
      }

      const next = params.toString()
      router.replace(next ? `${pathname}?${next}` : pathname)
    },
    [pathname, router, searchParams],
  )

  function renderSection(section: DesktopSettingsSection | null) {
    switch (section) {
      case 'providers':
        return <ProviderCredentialsPanel slug={slug} />
      case 'connectors':
        return (
          <ConnectorsManager
            slug={slug}
            embedded
            title="Connectors"
            description="Manage desktop workspace integrations without leaving the workspace."
          />
        )
      case 'appearance':
        return <AppearanceSettingsPanel />
      case 'agents':
        return <AgentsSettingsPanel slug={slug} />
      case 'skills':
        return <SkillsSettingsPanel slug={slug} />
      case 'advanced':
        return <AdvancedSettingsPanel slug={slug} />
      default:
        return null
    }
  }

  return (
    <Dialog open={Boolean(currentSection)} onOpenChange={(open) => !open && updateSection(null)}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] overflow-hidden p-0 sm:max-w-6xl">
        <DialogTitle className="sr-only">Desktop settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure providers, connectors, agents, skills, appearance, and advanced desktop workspace settings.
        </DialogDescription>

        <div className="flex h-[80vh] min-h-[640px] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
            <div>
              <p className="text-sm font-medium text-foreground">Settings</p>
              <p className="text-xs text-muted-foreground">Desktop workspace</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => updateSection(null)}
              aria-label="Close settings"
            >
              <X size={16} weight="bold" />
            </Button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
            <aside className="border-r border-border/60 bg-muted/20 p-4">
              <div>
                <p className="pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Sections
                </p>
              </div>

              <nav className="space-y-1">
                {DESKTOP_SETTINGS_SECTIONS.map((section) => (
                  <button
                    key={section}
                    type="button"
                    onClick={() => updateSection(section)}
                    className={cn(
                      'flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition-colors',
                      currentSection === section
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-background hover:text-foreground',
                    )}
                  >
                    {SECTION_LABELS[section]}
                  </button>
                ))}
              </nav>
            </aside>

            <div className="scrollbar-custom min-h-0 overflow-y-auto p-6">{renderSection(currentSection)}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

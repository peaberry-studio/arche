import { WorkspaceRestartSection } from '@/app/u/[slug]/settings/security/workspace-restart-section'
import { SettingsSection } from '@/components/settings/settings-section'

type AdvancedSettingsPanelProps = {
  slug: string
}

export function AdvancedSettingsPanel({ slug }: AdvancedSettingsPanelProps) {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">Advanced</h2>
        <p className="text-sm text-muted-foreground">
          Low-level controls for rebuilding and restarting this workspace.
        </p>
      </div>

      <SettingsSection
        headingLevel="h3"
        title="Workspace restart"
        description="Force a full restart of the local workspace runtime when connector or provider changes require a rebuild."
      >
        <WorkspaceRestartSection slug={slug} showHeader={false} />
      </SettingsSection>
    </section>
  )
}

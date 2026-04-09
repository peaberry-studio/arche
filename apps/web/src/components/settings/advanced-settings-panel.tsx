import { WorkspaceRestartSection } from '@/app/u/[slug]/settings/security/workspace-restart-section'

type AdvancedSettingsPanelProps = {
  slug: string
}

export function AdvancedSettingsPanel({ slug }: AdvancedSettingsPanelProps) {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-foreground">Advanced</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Force a full restart of the local workspace runtime when connector or provider changes require a rebuild.
        </p>
      </div>

      <WorkspaceRestartSection slug={slug} showHeader={false} />
    </section>
  )
}

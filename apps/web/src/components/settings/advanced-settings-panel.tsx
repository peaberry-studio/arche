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
          Restart the local workspace runtime after connector or provider changes when a full rebuild is required.
        </p>
      </div>

      <WorkspaceRestartSection slug={slug} />
    </section>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { SpinnerGap } from '@phosphor-icons/react'

import { ImportSkillDialog } from '@/components/skills/import-skill-dialog'
import { SkillForm } from '@/components/skills/skill-form'
import { SkillsList } from '@/components/skills/skills-list'
import { Button } from '@/components/ui/button'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import { useSkillsCatalog } from '@/hooks/use-skills-catalog'

type SkillsSettingsPanelProps = {
  slug: string
}

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; skillName: string }

export function SkillsSettingsPanel({ slug }: SkillsSettingsPanelProps) {
  const { skills, hash, isLoading, loadError, reload } = useSkillsCatalog(slug)
  const { agents } = useAgentsCatalog(slug)
  const [editorState, setEditorState] = useState<EditorState | null>(null)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)

  const editingSkill = editorState?.mode === 'edit'
    ? skills.find((skill) => skill.name === editorState.skillName) ?? null
    : null

  const agentOptions = useMemo(
    () => agents.map((agent) => ({ id: agent.id, displayName: agent.displayName, isPrimary: agent.isPrimary })),
    [agents]
  )

  async function handleEditorFinished() {
    await reload()
    setEditorState(null)
  }

  if (editorState) {
    return (
      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-medium text-foreground">
            {editorState.mode === 'create' ? 'Create skill' : `Edit ${editingSkill?.name ?? 'skill'}`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {editorState.mode === 'create'
              ? 'Define the SKILL.md instructions and choose which agents can use the new skill.'
              : 'Update the SKILL.md instructions and the default agent assignments for this skill.'}
          </p>
        </div>

        <SkillForm
          slug={slug}
          mode={editorState.mode}
          skillName={editorState.mode === 'edit' ? editorState.skillName : undefined}
          cancelLabel="Back to skills"
          onCancel={() => setEditorState(null)}
          onDeleted={handleEditorFinished}
          onSaved={handleEditorFinished}
        />
      </section>
    )
  }

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-lg font-medium text-foreground">Skills</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage reusable skill bundles and choose which agents can use them inside this desktop workspace.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setIsImportDialogOpen(true)}>
          Import skill
        </Button>
        <Button type="button" variant="outline" onClick={() => setEditorState({ mode: 'create' })}>
          Create skill
        </Button>
      </div>

      {isLoading ? (
        <div className="flex min-h-[240px] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SpinnerGap size={16} className="animate-spin" />
            Loading skills...
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div className="space-y-4 rounded-xl border border-border/60 bg-card/50 p-5">
          <p className="text-sm text-destructive">Failed to load: {loadError}</p>
          <Button type="button" variant="outline" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : null}

      {!isLoading && !loadError ? (
        <SkillsList
          slug={slug}
          skills={skills}
          isAdmin
          onEdit={(skillName) => setEditorState({ mode: 'edit', skillName })}
          emptyMessage="No skills configured yet."
        />
      ) : null}

      <ImportSkillDialog
        slug={slug}
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        agents={agentOptions}
        expectedHash={hash}
        onImported={reload}
      />
    </section>
  )
}

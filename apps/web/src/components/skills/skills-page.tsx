'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Lightning, SpinnerGap } from '@phosphor-icons/react'

import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'
import { ImportSkillDialog } from '@/components/skills/import-skill-dialog'
import { SkillsList } from '@/components/skills/skills-list'
import { Button } from '@/components/ui/button'
import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import { useSkillsCatalog } from '@/hooks/use-skills-catalog'

type SkillsPageClientProps = {
  isAdmin: boolean
  slug: string
}

export function SkillsPageClient({ slug, isAdmin }: SkillsPageClientProps) {
  const { skills, hash, isLoading, loadError, reload } = useSkillsCatalog(slug)
  const { agents } = useAgentsCatalog(slug)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)

  const agentOptions = useMemo(
    () => agents.map((agent) => ({ id: agent.id, displayName: agent.displayName, isPrimary: agent.isPrimary })),
    [agents]
  )

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="type-display text-3xl font-semibold tracking-tight">Skills</h1>
          <p className="text-muted-foreground">
            Manage reusable OpenCode skills and assign them to the agents that can use them.
          </p>
        </div>

        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setIsImportDialogOpen(true)}>
              Import skill
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href={`/u/${slug}/skills/new`}>Create skill</Link>
            </Button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex min-h-[220px] items-center justify-center">
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
        skills.length === 0 ? (
          <DashboardEmptyState
            icon={Lightning}
            title="No skills configured yet"
            description="Skills are reusable instructions and resources you can attach to agents. Create one from scratch or import a bundle to get started."
            primaryAction={
              isAdmin ? { label: 'Create your first skill', href: `/u/${slug}/skills/new` } : undefined
            }
            secondaryAction={
              isAdmin ? { label: 'Import skill', onClick: () => setIsImportDialogOpen(true) } : undefined
            }
          />
        ) : (
          <SkillsList
            slug={slug}
            skills={skills}
            isAdmin={isAdmin}
            emptyMessage="No skills configured yet."
          />
        )
      ) : null}

      <ImportSkillDialog
        slug={slug}
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        agents={agentOptions}
        expectedHash={hash}
        onImported={reload}
      />
    </div>
  )
}

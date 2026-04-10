'use client'

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import type { SkillListItem } from '@/hooks/use-skills-catalog'

type SkillsListProps = {
  emptyMessage: string
  isAdmin: boolean
  onEdit?: (skillName: string) => void
  skills: SkillListItem[]
  slug: string
}

export function SkillsList({ slug, skills, isAdmin, onEdit, emptyMessage }: SkillsListProps) {
  if (skills.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {skills.map((skill) => (
        <article key={skill.name} className="rounded-xl border border-border/60 bg-card/40 p-5">
          <div className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-lg font-medium text-foreground">{skill.name}</h2>
              <p className="text-sm text-muted-foreground">{skill.description}</p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border/60 px-2 py-1">
                {skill.assignedAgentIds.length} agent{skill.assignedAgentIds.length === 1 ? '' : 's'}
              </span>
              <span className="rounded-full border border-border/60 px-2 py-1">
                {skill.hasResources ? `${skill.resourcePaths.length} bundled file${skill.resourcePaths.length === 1 ? '' : 's'}` : 'SKILL.md only'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button type="button" variant="outline" asChild>
                <a href={`/api/u/${slug}/skills/${skill.name}/export`}>Export</a>
              </Button>

              {isAdmin ? (
                onEdit ? (
                  <Button type="button" variant="ghost" onClick={() => onEdit(skill.name)}>
                    Edit
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" asChild>
                    <Link href={`/u/${slug}/skills/${skill.name}`}>Edit</Link>
                  </Button>
                )
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

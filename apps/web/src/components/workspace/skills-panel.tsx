'use client'

import { useMemo } from 'react'
import { Lightning } from '@phosphor-icons/react'

import type { SkillListItem } from '@/hooks/use-skills-catalog'
import { cn } from '@/lib/utils'

type SkillsPanelProps = {
  query?: string
  skills: SkillListItem[]
}

export function SkillsPanel({ skills, query = '' }: SkillsPanelProps) {
  const normalizedQuery = query.trim().toLowerCase()
  const filteredSkills = useMemo(() => {
    if (!normalizedQuery) return skills

    return skills.filter((skill) => {
      const name = skill.name.toLowerCase()
      const description = skill.description.toLowerCase()
      return name.includes(normalizedQuery) || description.includes(normalizedQuery)
    })
  }, [normalizedQuery, skills])

  if (skills.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <Lightning size={24} weight="bold" className="text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">No skills available</p>
      </div>
    )
  }

  if (filteredSkills.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <Lightning size={24} weight="bold" className="text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">No skills found</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-1.5 scrollbar-none">
      <div className="space-y-2">
        {filteredSkills.map((skill) => (
          <div
            key={skill.name}
            className={cn('rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-left')}
          >
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/80 text-muted-foreground">
                <Lightning size={12} weight="bold" />
              </div>
              <span className="truncate text-[13px] font-medium text-foreground/90">{skill.name}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

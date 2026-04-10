'use client'

import { useMemo } from 'react'
import { Lightning } from '@phosphor-icons/react'

import type { SkillListItem } from '@/hooks/use-skills-catalog'

type SkillsPanelProps = {
  query?: string
  skills: SkillListItem[]
  onSelectSkill?: (skill: SkillListItem) => void
}

export function SkillsPanel({ skills, query = '', onSelectSkill }: SkillsPanelProps) {
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
      <div className="space-y-0.5">
        {filteredSkills.map((skill) => (
          <button
            key={skill.name}
            type="button"
            onClick={() => onSelectSkill?.(skill)}
            className="flex w-full items-center gap-2.5 rounded-lg pl-1.5 pr-2 py-1.5 text-left text-[13px] text-foreground/80 transition-colors hover:bg-foreground/5"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/80 text-muted-foreground">
              <Lightning size={12} weight="bold" />
            </div>
            <span className="flex-1 truncate font-medium">{skill.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

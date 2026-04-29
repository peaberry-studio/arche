'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookOpenText,
  Check,
  Lightning,
  PaperPlaneTilt,
  Robot,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { setWorkspaceStartPrompt } from '@/lib/workspace-start-prompt'

type RecentUpdate = {
  fileName: string
  filePath: string
}

type AgentItem = {
  id: string
  displayName: string
  description?: string
  isPrimary?: boolean
}

type SkillItem = {
  name: string
  description?: string
}

type DashboardHeroProps = {
  slug: string
  agents: AgentItem[]
  recentUpdates: RecentUpdate[]
  skills?: SkillItem[]
}

type ToggleId = 'knowledge' | 'experts' | 'skills'

export function DashboardHero({
  slug,
  agents,
  recentUpdates,
  skills = [],
}: DashboardHeroProps) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [inputValue, setInputValue] = useState('')
  const [openToggle, setOpenToggle] = useState<ToggleId | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set())
  const [selectedExpert, setSelectedExpert] = useState<string | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => new Set())

  // Close any open toggle on outside click and on Escape.
  useEffect(() => {
    if (!openToggle) return

    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setOpenToggle(null)
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenToggle(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [openToggle])

  const composePrompt = useCallback(() => {
    const trimmed = inputValue.trim()
    const segments: string[] = []
    if (selectedExpert) segments.push(`@${selectedExpert}`)
    for (const path of selectedFiles) segments.push(`[[${path}]]`)
    for (const skill of selectedSkills) segments.push(`/${skill}`)
    if (segments.length === 0) return trimmed
    if (!trimmed) return segments.join(' ')
    return `${segments.join(' ')}\n\n${trimmed}`
  }, [inputValue, selectedExpert, selectedFiles, selectedSkills])

  const isSendDisabled = composePrompt().length === 0

  function handleInputChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputValue(event.target.value)
    const textarea = event.target
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`
  }

  function handleSubmit() {
    const prompt = composePrompt()
    if (!prompt) return

    try {
      setWorkspaceStartPrompt(window.sessionStorage, slug, {
        text: prompt,
        contextPaths: Array.from(selectedFiles),
      })
    } catch {
      // ignore — if storage is unavailable, fallback is just navigation
    }
    router.push(`/w/${slug}`)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  function toggleFile(path: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleSkill(name: string) {
    setSelectedSkills((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function selectExpert(id: string) {
    setSelectedExpert((prev) => (prev === id ? null : id))
  }

  function toggleOpen(id: ToggleId) {
    setOpenToggle((prev) => (prev === id ? null : id))
  }

  return (
    <section className="w-full max-w-3xl">
      <h1 className="type-serif mb-7 text-center text-3xl leading-tight italic text-foreground/90 sm:mb-10 sm:text-4xl md:text-5xl">
        What do you want to work on today?
      </h1>

      <div
        ref={containerRef}
        className="relative rounded-3xl border border-border/60 bg-card/70 px-4 pb-4 pt-3.5 shadow-subtle backdrop-blur-md transition-shadow focus-within:border-border/80 focus-within:shadow-md sm:px-5 sm:pb-5 sm:pt-4"
      >
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          rows={1}
          className="block min-h-[38px] w-full resize-none bg-transparent pr-12 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground/60 sm:min-h-[44px] sm:pr-0 sm:text-lg sm:leading-relaxed"
          placeholder="Describe what you want to work on..."
        />

        <div className="mt-3 flex items-center gap-2 sm:mt-2 sm:items-end">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:items-end">
            <ComposerToggle
              id="knowledge"
              icon={<BookOpenText size={14} weight="regular" />}
              label="Knowledge"
              count={selectedFiles.size}
              isOpen={openToggle === 'knowledge'}
              onToggle={() => toggleOpen('knowledge')}
              panel={
                <KnowledgePanel
                  recentUpdates={recentUpdates}
                  selected={selectedFiles}
                  onToggle={toggleFile}
                />
              }
            />
            <ComposerToggle
              id="experts"
              icon={<Robot size={14} weight="regular" />}
              label="Experts"
              count={selectedExpert ? 1 : 0}
              isOpen={openToggle === 'experts'}
              onToggle={() => toggleOpen('experts')}
              panel={
                <ExpertsPanel
                  agents={agents}
                  selected={selectedExpert}
                  onSelect={selectExpert}
                />
              }
            />
            <ComposerToggle
              id="skills"
              icon={<Lightning size={14} weight="regular" />}
              label="Skills"
              count={selectedSkills.size}
              isOpen={openToggle === 'skills'}
              onToggle={() => toggleOpen('skills')}
              panel={
                <SkillsPanel
                  skills={skills}
                  selected={selectedSkills}
                  onToggle={toggleSkill}
                />
              }
            />
          </div>

          <div className="absolute right-4 top-3.5 shrink-0 sm:static sm:ml-auto">
            <Button
              size="icon"
              className="h-10 w-10 rounded-lg"
              disabled={isSendDisabled}
              onClick={handleSubmit}
              aria-label="Start working"
            >
              <PaperPlaneTilt size={16} weight="fill" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

type ComposerToggleProps = {
  id: ToggleId
  icon: React.ReactNode
  label: string
  count: number
  isOpen: boolean
  onToggle: () => void
  panel: React.ReactNode
}

function ComposerToggle({
  id,
  icon,
  label,
  count,
  isOpen,
  onToggle,
  panel,
}: ComposerToggleProps) {
  const panelId = `composer-toggle-${id}`

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={panelId}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          isOpen || count > 0
            ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
            : 'border-border/60 bg-foreground/5 text-foreground/80 hover:bg-foreground/10 hover:text-foreground',
        )}
      >
        <span aria-hidden="true" className="flex">
          {icon}
        </span>
        <span>{label}</span>
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="ml-0.5 text-[11px] font-semibold leading-none tabular-nums text-current opacity-80"
          >
            {count}
          </span>
        ) : null}
      </button>
      {isOpen ? (
        <div
          id={panelId}
          role="menu"
          aria-label={label}
          className="absolute left-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] origin-top-left rounded-xl border border-border/60 bg-popover/95 p-1 shadow-lg backdrop-blur-md"
        >
          {panel}
        </div>
      ) : null}
    </div>
  )
}

function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-4 text-center text-sm text-muted-foreground">{children}</p>
}

function KnowledgePanel({
  recentUpdates,
  selected,
  onToggle,
}: {
  recentUpdates: RecentUpdate[]
  selected: Set<string>
  onToggle: (path: string) => void
}) {
  if (recentUpdates.length === 0) {
    return <PanelEmpty>No recent files yet.</PanelEmpty>
  }
  return (
    <ul role="none" className="max-h-72 overflow-y-auto scrollbar-custom">
      {recentUpdates.map((item) => {
        const isSelected = selected.has(item.filePath)
        return (
          <li role="none" key={item.filePath}>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={isSelected}
              onClick={() => onToggle(item.filePath)}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-foreground/5 focus:bg-foreground/5 focus:outline-none"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border',
                )}
              >
                {isSelected ? <Check size={12} weight="bold" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{item.fileName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.filePath}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function getAgentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function ExpertsPanel({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentItem[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  if (agents.length === 0) {
    return <PanelEmpty>No experts available yet.</PanelEmpty>
  }
  return (
    <ul role="none" className="max-h-72 overflow-y-auto scrollbar-custom">
      {agents.map((agent) => {
        const isSelected = selected === agent.id
        const initials = getAgentInitials(agent.displayName)
        return (
          <li role="none" key={agent.id}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={isSelected}
              onClick={() => onSelect(agent.id)}
              className={cn(
                'group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors focus:outline-none',
                isSelected
                  ? 'bg-primary/10 hover:bg-primary/15'
                  : 'hover:bg-foreground/5 focus:bg-foreground/5',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary transition-opacity',
                  isSelected ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold uppercase tracking-wide transition-colors',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-foreground/10 text-foreground/70 group-hover:bg-foreground/15',
                )}
              >
                {initials}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-sm transition-colors',
                    isSelected ? 'font-medium text-primary' : 'text-foreground',
                  )}
                >
                  {agent.displayName}
                </span>
                {agent.description ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {agent.description}
                  </span>
                ) : (
                  <span className="block truncate text-xs text-muted-foreground/70">
                    @{agent.id}
                  </span>
                )}
              </span>
              {isSelected ? (
                <Check
                  size={14}
                  weight="bold"
                  aria-hidden="true"
                  className="shrink-0 text-primary"
                />
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function SkillsPanel({
  skills,
  selected,
  onToggle,
}: {
  skills: SkillItem[]
  selected: Set<string>
  onToggle: (name: string) => void
}) {
  if (skills.length === 0) {
    return <PanelEmpty>No skills available yet.</PanelEmpty>
  }
  return (
    <ul role="none" className="max-h-72 overflow-y-auto scrollbar-custom">
      {skills.map((skill) => {
        const isSelected = selected.has(skill.name)
        return (
          <li role="none" key={skill.name}>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={isSelected}
              onClick={() => onToggle(skill.name)}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-foreground/5 focus:bg-foreground/5 focus:outline-none"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border',
                )}
              >
                {isSelected ? <Check size={12} weight="bold" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{skill.name}</span>
                {skill.description ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {skill.description}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookOpenText,
  CaretDown,
  Check,
  Lightning,
  MagnifyingGlass,
  PaperPlaneTilt,
  Robot,
} from '@phosphor-icons/react'

import { GlyphAvatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BitmapGlyph } from '@/components/workspace/bitmap-glyph'
import { getEmptyComposerGlyph } from '@/components/workspace/empty-composer-glyphs'
import { pickEmptyComposerIntent } from '@/components/workspace/empty-composer-intents'
import type { AgentCatalogItem } from '@/hooks/use-workspace'
import type { SkillListItem } from '@/hooks/use-skills-catalog'
import type { AvailableModel } from '@/lib/opencode/types'
import { cn } from '@/lib/utils'

type RecentUpdate = {
  fileName: string
  filePath: string
}

type WorkspaceChatEmptyComposerProps = {
  agents: AgentCatalogItem[]
  agentDefaultModel?: AvailableModel | null
  models?: AvailableModel[]
  onSendMessage: (
    text: string,
    model?: { providerId: string; modelId: string },
    options?: { forceNewSession?: boolean; contextPaths?: string[] }
  ) => Promise<boolean> | boolean
  onSelectModel?: (model: AvailableModel | null) => void
  recentUpdates?: RecentUpdate[]
  selectedModel?: AvailableModel | null
  skills?: SkillListItem[]
}

type ToggleId = 'knowledge' | 'experts' | 'skills'

export function WorkspaceChatEmptyComposer({
  agents,
  agentDefaultModel = null,
  models = [],
  onSendMessage,
  onSelectModel,
  recentUpdates = [],
  selectedModel = null,
  skills = [],
}: WorkspaceChatEmptyComposerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [intent] = useState(() => pickEmptyComposerIntent())
  const [inputValue, setInputValue] = useState('')
  const [openToggle, setOpenToggle] = useState<ToggleId | null>(null)
  const [modelSearch, setModelSearch] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set())
  const [selectedExpert, setSelectedExpert] = useState<string | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => new Set())

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
  const glyph = getEmptyComposerGlyph(intent)

  function handleInputChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputValue(event.target.value)
    const textarea = event.target
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`
  }

  function handleSubmit() {
    const prompt = composePrompt()
    if (!prompt) return

    void onSendMessage(prompt, undefined, {
      forceNewSession: true,
      contextPaths: Array.from(selectedFiles),
    })
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
      <div className="mb-7 flex flex-col items-center gap-3 sm:mb-10 sm:gap-4">
        <span data-testid="empty-composer-glyph" className="text-primary">
          <BitmapGlyph
            dotGapPx={2}
            dotSizePx={4}
            frames={glyph.frames}
            intervalMs={glyph.intervalMs}
          />
        </span>
        <h1
          suppressHydrationWarning
          data-testid="empty-composer-heading"
          className="type-display text-center text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl md:text-5xl"
        >
          {intent}
        </h1>
      </div>

      <div
        ref={containerRef}
        className="relative rounded-3xl border border-border/60 bg-card/70 px-4 pb-4 pt-3.5 shadow-subtle backdrop-blur-md transition-shadow focus-within:border-border/80 focus-within:shadow-md sm:px-5 sm:pb-5 sm:pt-4"
      >
        <textarea
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          rows={1}
          aria-label="Describe what you want to work on"
          className="block min-h-[38px] w-full resize-none bg-transparent text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground/60 sm:min-h-[44px] sm:text-lg sm:leading-relaxed"
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

          <div className="flex shrink-0 items-end gap-2">
            {models.length > 0 ? (
              <DropdownMenu onOpenChange={(open) => { if (!open) setModelSearch('') }}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="max-w-[160px] truncate">
                      {selectedModel?.modelName ?? 'Select model'}
                    </span>
                    <CaretDown size={11} weight="bold" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-72 p-0">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search models..."
                      value={modelSearch}
                      onChange={(event) => setModelSearch(event.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                      className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                  <div className="scrollbar-custom max-h-64 overflow-y-auto p-1">
                    {models
                      .filter((model) => {
                        if (!modelSearch) return true
                        const query = modelSearch.toLowerCase()
                        return (
                          model.modelName.toLowerCase().includes(query) ||
                          model.providerName.toLowerCase().includes(query) ||
                          model.modelId.toLowerCase().includes(query)
                        )
                      })
                      .map((model) => {
                        const isAgentDefault =
                          agentDefaultModel?.providerId === model.providerId &&
                          agentDefaultModel?.modelId === model.modelId
                        const isSelected =
                          selectedModel?.modelId === model.modelId &&
                          selectedModel?.providerId === model.providerId
                        return (
                          <DropdownMenuItem
                            key={`${model.providerId}-${model.modelId}`}
                            onSelect={() => onSelectModel?.(model)}
                            className={cn(isSelected && 'bg-primary/10')}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{model.modelName}</span>
                              <span className="text-xs text-muted-foreground">{model.providerName}</span>
                            </div>
                            {isAgentDefault ? (
                              <span className="ml-auto text-[10px] text-primary">Agent default</span>
                            ) : model.isDefault ? (
                              <span className="ml-auto text-[10px] text-muted-foreground">Provider default</span>
                            ) : null}
                          </DropdownMenuItem>
                        )
                      })}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
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

function ExpertsPanel({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentCatalogItem[]
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
              <GlyphAvatar seed={agent.id} kind="agent" size={28} />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-sm transition-colors',
                    isSelected ? 'font-medium text-primary' : 'text-foreground',
                  )}
                >
                  {agent.displayName}
                </span>
                {agent.displayName !== agent.id && (
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
  skills: SkillListItem[]
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

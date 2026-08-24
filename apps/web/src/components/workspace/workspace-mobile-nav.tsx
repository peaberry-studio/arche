'use client'

import type { ComponentType } from 'react'
import { ChatCircle, Database, GraduationCap, List } from '@phosphor-icons/react'

import { cn } from '@/lib/utils'

type WorkspaceMobileNavProps = {
  chatActive: boolean
  curatorActive: boolean
  curatorBadgeCount?: number
  knowledgeActive: boolean
  menuActive: boolean
  onChat: () => void
  onCurator: () => void
  onKnowledge: () => void
  onMenu: () => void
}

type MobileNavButtonProps = {
  active?: boolean
  badgeCount?: number
  icon: ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>
  label: string
  onClick: () => void
}

function MobileNavButton({ active = false, badgeCount, icon: Icon, label, onClick }: MobileNavButtonProps) {
  const showBadge = typeof badgeCount === 'number' && badgeCount > 0

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={showBadge ? `${label}, ${badgeCount} pending` : label}
      aria-pressed={active}
      className={cn(
        'relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground active:text-foreground',
      )}
    >
      <span className="relative">
        <Icon size={22} weight={active ? 'fill' : 'regular'} />
        {showBadge ? (
          <span aria-hidden className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
        ) : null}
      </span>
      <span>{label}</span>
    </button>
  )
}

export function WorkspaceMobileNav({
  chatActive,
  curatorActive,
  curatorBadgeCount,
  knowledgeActive,
  menuActive,
  onChat,
  onCurator,
  onKnowledge,
  onMenu,
}: WorkspaceMobileNavProps) {
  return (
    <nav
      className="grid shrink-0 grid-cols-4 border-t border-border/40 bg-background md:hidden"
      style={{
        minHeight: 'calc(3.25rem + env(safe-area-inset-bottom, 0px))',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      aria-label="Workspace sections"
    >
      <MobileNavButton active={chatActive} icon={ChatCircle} label="Chat" onClick={onChat} />
      <MobileNavButton active={knowledgeActive} icon={Database} label="Knowledge" onClick={onKnowledge} />
      <MobileNavButton
        active={curatorActive}
        badgeCount={curatorBadgeCount}
        icon={GraduationCap}
        label="Curator"
        onClick={onCurator}
      />
      <MobileNavButton active={menuActive} icon={List} label="Menu" onClick={onMenu} />
    </nav>
  )
}

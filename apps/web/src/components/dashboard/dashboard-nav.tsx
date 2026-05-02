'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowLineLeft,
  ArrowLineRight,
  ChatCircle,
  Cpu,
  Database,
  GearSix,
  Lightning,
  List,
  Plugs,
  Robot,
  Sparkle,
  SquaresFour,
  UsersThree,
  X,
  type Icon,
} from '@phosphor-icons/react'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type DashboardNavItem = {
  label: string
  href: string
  activeHref?: string
  exact?: boolean
  icon: Icon
}

const DASHBOARD_NAV_OFFSET_PROPERTY = '--dashboard-nav-offset'
const DASHBOARD_NAV_COLLAPSED_OFFSET = '5rem'
const DASHBOARD_NAV_EXPANDED_OFFSET = '13.5rem'
const DASHBOARD_NAV_COLLAPSED_WIDTH_CLASS = 'w-10'
const DASHBOARD_NAV_EXPANDED_WIDTH_CLASS = 'w-44'

function getWebNavItems(slug: string): DashboardNavItem[] {
  const base = `/u/${slug}`

  return [
    { label: 'New Chat', href: base, activeHref: base, exact: true, icon: ChatCircle },
    { label: 'Knowledge', href: `/w/${slug}?mode=knowledge`, icon: Database },
    { label: 'Agents', href: `${base}/agents`, icon: Robot },
    { label: 'Skills', href: `${base}/skills`, icon: Lightning },
    { label: 'Autopilot', href: `${base}/autopilot`, icon: Sparkle },
    { label: 'Connectors', href: `${base}/connectors`, icon: Plugs },
    { label: 'Team', href: `${base}/team`, icon: UsersThree },
    { label: 'Settings', href: `${base}/settings`, icon: GearSix },
  ]
}

function getDesktopNavItems(slug: string): DashboardNavItem[] {
  return [
    { label: 'Workspace', href: `/w/${slug}`, activeHref: `/w/${slug}`, exact: true, icon: SquaresFour },
    { label: 'Knowledge', href: `/w/${slug}?mode=knowledge`, icon: Database },
    { label: 'Agents', href: `/u/${slug}/agents`, icon: Robot },
    { label: 'Skills', href: `/w/${slug}?settings=skills`, icon: Lightning },
    { label: 'Connectors', href: `/w/${slug}?settings=connectors`, icon: Plugs },
    { label: 'Providers', href: `/w/${slug}?settings=providers`, icon: Cpu },
    { label: 'Settings', href: `/w/${slug}?settings=appearance`, icon: GearSix },
  ]
}

function isNavItemActive(pathname: string, item: DashboardNavItem): boolean {
  const activeHref = item.activeHref ?? item.href

  if (item.exact) return pathname === activeHref

  return pathname.startsWith(activeHref)
}

export function DashboardNav({
  slug,
  desktopMode = false,
  displayLabel,
  hasWindowInset = false,
}: {
  slug: string
  desktopMode?: boolean
  displayLabel?: string
  hasWindowInset?: boolean
}) {
  const pathname = usePathname()
  const workspaceHref = `/w/${slug}`
  const navItems = desktopMode ? getDesktopNavItems(slug) : getWebNavItems(slug)
  const [isExpanded, setIsExpanded] = useState(false)
  const [menuState, setMenuState] = useState<{ open: boolean; pathname: string }>({
    open: false,
    pathname,
  })
  const menuRef = useRef<HTMLDivElement>(null)

  const mobileMenuOpen = menuState.open && menuState.pathname === pathname

  useEffect(() => {
    const root = document.documentElement

    // Consumed by md+ dashboard layouts; mobile ignores the offset in CSS.
    root.style.setProperty(
      DASHBOARD_NAV_OFFSET_PROPERTY,
      isExpanded ? DASHBOARD_NAV_EXPANDED_OFFSET : DASHBOARD_NAV_COLLAPSED_OFFSET,
    )

    return () => {
      root.style.removeProperty(DASHBOARD_NAV_OFFSET_PROPERTY)
    }
  }, [isExpanded])

  useEffect(() => {
    if (!mobileMenuOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuState((prev) => ({ ...prev, open: false }))
      }
    }

    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [mobileMenuOpen])

  function handleExpandedChange(nextExpanded: boolean) {
    setIsExpanded(nextExpanded)
  }

  return (
    <div ref={menuRef} className="relative">
      <TooltipProvider delayDuration={350}>
        <aside
          className={cn(
            'fixed bottom-6 left-5 z-40 hidden flex-col text-card-foreground transition-[width] duration-200 md:flex',
            hasWindowInset ? 'top-10' : 'top-6',
            isExpanded ? DASHBOARD_NAV_EXPANDED_WIDTH_CLASS : DASHBOARD_NAV_COLLAPSED_WIDTH_CLASS,
          )}
        >
          <div className="flex flex-col items-start gap-2">
            <DashboardNavToggle
              isExpanded={isExpanded}
              onToggle={() => handleExpandedChange(!isExpanded)}
            />
          </div>

          <nav aria-label="Dashboard" className="mt-6 flex flex-1 flex-col gap-1.5">
            {navItems.map((item) => (
              <DashboardNavLink
                key={item.label}
                item={item}
                isActive={isNavItemActive(pathname, item)}
                isExpanded={isExpanded}
              />
            ))}
          </nav>

          <div className="mt-4">
            <DashboardNavLink
              item={{ label: 'Open Workspace', href: workspaceHref, icon: SquaresFour }}
              isActive={pathname.startsWith(workspaceHref)}
              isExpanded={isExpanded}
              isPrimary
            />
          </div>
        </aside>
      </TooltipProvider>

      <nav className="glass-bar flex h-14 items-center rounded-2xl border-border/40 bg-card/65 pl-5 pr-2 text-card-foreground shadow-none md:hidden">
        <div className="flex min-w-0 items-center">
          <Link href="/" className="type-display mr-2 text-base font-semibold">
            Archē
          </Link>
          <span className="truncate text-sm text-muted-foreground">/&nbsp;{displayLabel ?? slug}</span>
        </div>

        <button
          type="button"
          onClick={() => setMenuState({ open: !mobileMenuOpen, pathname })}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileMenuOpen ? <X size={20} weight="bold" /> : <List size={20} weight="bold" />}
        </button>
      </nav>

      {mobileMenuOpen && (
        <div className="absolute inset-x-0 top-full z-40 mt-2 rounded-xl border border-border/40 bg-card/95 p-2 shadow-lg backdrop-blur-lg md:hidden">
          {navItems.map((item) => {
            const isActive = isNavItemActive(pathname, item)
            const Icon = item.icon

            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                <Icon size={16} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" />
                {item.label}
              </Link>
            )
          })}

          <div className="my-1.5 h-px bg-border/40" />

          <Link
            href={workspaceHref}
            className="flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
          >
            <SquaresFour size={16} weight="bold" aria-hidden="true" />
            Open Workspace
          </Link>
        </div>
      )}
    </div>
  )
}

function DashboardNavToggle({
  isExpanded,
  onToggle,
}: {
  isExpanded: boolean
  onToggle: () => void
}) {
  const button = (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex h-10 items-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground',
        isExpanded ? 'w-full gap-3 px-3' : `${DASHBOARD_NAV_COLLAPSED_WIDTH_CLASS} justify-center`,
      )}
      aria-label={isExpanded ? 'Collapse navigation' : 'Expand navigation'}
      aria-expanded={isExpanded}
    >
      {isExpanded ? (
        <ArrowLineLeft size={18} weight="bold" />
      ) : (
        <ArrowLineRight size={18} weight="bold" />
      )}
      <span className={cn('min-w-0 truncate text-sm', !isExpanded && 'sr-only')}>
        Collapse
      </span>
    </button>
  )

  if (isExpanded) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">Expand navigation</TooltipContent>
    </Tooltip>
  )
}

function DashboardNavLink({
  item,
  isActive,
  isExpanded,
  isPrimary = false,
}: {
  item: DashboardNavItem
  isActive: boolean
  isExpanded: boolean
  isPrimary?: boolean
}) {
  const Icon = item.icon
  const link = (
    <Link
      href={item.href}
      className={cn(
        'group flex h-10 items-center rounded-xl text-sm transition-colors',
        isExpanded ? 'gap-3 px-3' : 'justify-center',
        isPrimary
          ? 'bg-foreground/10 font-medium text-foreground hover:bg-foreground/15'
          : isActive
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      <Icon
        size={18}
        weight={isActive || isPrimary ? 'fill' : 'regular'}
        className="shrink-0"
        aria-hidden="true"
      />
      <span className={cn('min-w-0 truncate', !isExpanded && 'sr-only')}>
        {item.label}
      </span>
    </Link>
  )

  if (isExpanded) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

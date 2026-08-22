'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  CaretLineLeft,
  CaretLineRight,
  ChatCircle,
  Cpu,
  Database,
  GearSix,
  GitBranch,
  GraduationCap,
  Lightning,
  List,
  Plugs,
  Robot,
  SquaresFour,
  X,
  type Icon,
} from '@phosphor-icons/react'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ArcheMark } from '@/components/workspace/arche-mark'
import {
  getDashboardNavExpandedCookieName,
  getDashboardNavExpandedStorageKey,
} from '@/lib/dashboard-nav-state'
import { getDesktopFlowsHref } from '@/lib/runtime/desktop/current-vault'
import { cn } from '@/lib/utils'
import { getWorkspaceHref } from '@/lib/workspace-hrefs'
import { persistWorkspacePanelState } from '@/lib/workspace-panel-state'

type DashboardNavItem = {
  label: string
  href: string
  activeHref?: string
  exact?: boolean
  icon: Icon
}

const DASHBOARD_NAV_OFFSET_PROPERTY = '--dashboard-nav-offset'
const DASHBOARD_NAV_COLLAPSED_OFFSET = '3rem'
const DASHBOARD_NAV_EXPANDED_OFFSET = '12.5rem'
const DASHBOARD_NAV_COLLAPSED_WIDTH_CLASS = 'w-12'
const DASHBOARD_NAV_EXPANDED_WIDTH_CLASS = 'w-50'

function getWebNavItems(slug: string): DashboardNavItem[] {
  const base = `/u/${slug}`

  return [
    { label: 'New Chat', href: base, activeHref: base, exact: true, icon: ChatCircle },
    { label: 'Knowledge Base', href: getWorkspaceHref(slug, { mode: 'explore' }), icon: Database },
    { label: 'Knowledge', href: getWorkspaceHref(slug, { mode: 'knowledge' }), icon: GraduationCap },
    { label: 'Agents', href: `${base}/agents`, icon: Robot },
    { label: 'Skills', href: `${base}/skills`, icon: Lightning },
    { label: 'Flows', href: `${base}/flows`, icon: GitBranch },
    { label: 'Connectors', href: `${base}/connectors`, icon: Plugs },
    { label: 'Settings', href: `${base}/settings`, icon: GearSix },
  ]
}

function getDesktopNavItems(slug: string): DashboardNavItem[] {
  return [
    { label: 'Workspace', href: getWorkspaceHref(slug), activeHref: getWorkspaceHref(slug), exact: true, icon: SquaresFour },
    { label: 'Knowledge Base', href: getWorkspaceHref(slug, { mode: 'explore' }), icon: Database },
    { label: 'Knowledge', href: getWorkspaceHref(slug, { mode: 'knowledge' }), icon: GraduationCap },
    { label: 'Agents', href: `/u/${slug}/agents`, icon: Robot },
    { label: 'Flows', href: getDesktopFlowsHref(slug, 'list'), icon: GitBranch },
    { label: 'Skills', href: getWorkspaceHref(slug, { settings: 'skills' }), icon: Lightning },
    { label: 'Connectors', href: getWorkspaceHref(slug, { settings: 'connectors' }), icon: Plugs },
    { label: 'Providers', href: getWorkspaceHref(slug, { settings: 'providers' }), icon: Cpu },
    { label: 'Settings', href: getWorkspaceHref(slug, { settings: 'appearance' }), icon: GearSix },
  ]
}

function isNavItemActive(pathname: string, search: URLSearchParams, item: DashboardNavItem): boolean {
  const activeHref = item.activeHref ?? item.href
  const [activePath, activeQuery] = activeHref.split('?')

  if (item.exact ? pathname !== activePath : !pathname.startsWith(activePath)) return false
  if (!activeQuery) return true

  // The item's query params must all be present; extra params (e.g. a file
  // path deep link) do not break the active state.
  for (const [key, value] of new URLSearchParams(activeQuery)) {
    if (search.get(key) !== value) return false
  }
  return true
}

export function DashboardNav({
  slug,
  desktopMode = false,
  displayLabel,
  hasWindowInset = false,
  initialExpanded = true,
}: {
  slug: string
  desktopMode?: boolean
  displayLabel?: string
  hasWindowInset?: boolean
  initialExpanded?: boolean
}) {
  const pathname = usePathname()
  const search = useSearchParams()
  const workspaceHref = getWorkspaceHref(slug)
  const navItems = desktopMode ? getDesktopNavItems(slug) : getWebNavItems(slug)
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
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
    persistWorkspacePanelState(
      getDashboardNavExpandedStorageKey(slug),
      getDashboardNavExpandedCookieName(slug),
      isExpanded,
    )

    return () => {
      root.style.removeProperty(DASHBOARD_NAV_OFFSET_PROPERTY)
    }
  }, [isExpanded, slug])

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

  const openWorkspaceItem: DashboardNavItem = {
    label: 'Open Workspace',
    href: workspaceHref,
    icon: SquaresFour,
  }

  return (
    <div ref={menuRef} className="relative">
      <TooltipProvider delayDuration={150}>
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border/30 bg-background text-card-foreground transition-[width] duration-200 md:flex',
            isExpanded ? DASHBOARD_NAV_EXPANDED_WIDTH_CLASS : DASHBOARD_NAV_COLLAPSED_WIDTH_CLASS,
          )}
        >
          {isExpanded ? (
            <>
              <div
                className={cn(
                  'flex h-11 shrink-0 items-center justify-between gap-2 pl-4 pr-1.5',
                  hasWindowInset && 'desktop-titlebar-drag',
                )}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  {hasWindowInset ? (
                    <div aria-label="macOS traffic lights" className="desktop-titlebar-drag pl-[88px]" />
                  ) : null}
                  <span className="type-display shrink-0 text-base font-semibold tracking-tight">Arche</span>
                  <span className="truncate text-[12px] text-muted-foreground">
                    /&nbsp;{displayLabel ?? slug}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsExpanded(false)}
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground',
                    hasWindowInset && 'desktop-titlebar-no-drag',
                  )}
                  aria-label="Collapse navigation"
                  title="Collapse navigation"
                >
                  <CaretLineLeft size={14} weight="bold" />
                </button>
              </div>

              <nav aria-label="Dashboard navigation" className="flex flex-col gap-0.5 px-1.5 pt-1">
                {navItems.map((item) => (
                  <DashboardNavLink
                    key={item.label}
                    item={item}
                    isActive={isNavItemActive(pathname, search, item)}
                    isExpanded
                  />
                ))}
              </nav>

              <div className="mt-auto shrink-0 border-t border-border/40 p-1.5">
                <DashboardNavLink
                  item={openWorkspaceItem}
                  isActive={pathname.startsWith(workspaceHref)}
                  isExpanded
                  isPrimary
                />
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-0 flex-col items-center py-2">
              <div className="flex h-7 w-7 items-center justify-center">
                <ArcheMark className="text-primary" size={16} />
              </div>

              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="mt-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                aria-label="Expand navigation"
                title="Expand navigation"
              >
                <CaretLineRight size={14} weight="bold" />
              </button>

              <div className="my-2 h-px w-6 bg-border/40" />

              <nav aria-label="Dashboard navigation" className="flex w-full flex-col items-center gap-1">
                {navItems.map((item) => (
                  <DashboardNavLink
                    key={item.label}
                    item={item}
                    isActive={isNavItemActive(pathname, search, item)}
                    isExpanded={false}
                  />
                ))}
              </nav>

              <div className="mt-auto pt-2">
                <DashboardNavLink
                  item={openWorkspaceItem}
                  isActive={pathname.startsWith(workspaceHref)}
                  isExpanded={false}
                  isPrimary
                />
              </div>
            </div>
          )}
        </aside>
      </TooltipProvider>

      <nav className="glass-bar flex h-14 items-center rounded-2xl border-border/40 bg-card/65 pl-5 pr-2 text-card-foreground shadow-none md:hidden">
        <div className="flex min-w-0 items-center">
          <Link href="/" className="type-display mr-2 text-base font-semibold">
            Arche
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
            const isActive = isNavItemActive(pathname, search, item)
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
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group flex h-8 items-center rounded-md text-[12px] font-medium transition-colors',
        isExpanded ? 'w-full gap-2 px-2.5' : 'relative w-8 justify-center px-2',
        isPrimary
          ? 'bg-foreground/10 text-foreground hover:bg-foreground/15'
          : isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      <Icon
        size={15}
        weight={isActive || isPrimary ? 'fill' : 'bold'}
        className="shrink-0"
        aria-hidden="true"
      />
      {isExpanded ? (
        <span className="flex-1 truncate text-left leading-none">{item.label}</span>
      ) : (
        <span className="sr-only">{item.label}</span>
      )}
    </Link>
  )

  if (isExpanded) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

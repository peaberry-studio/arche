'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const webNavItems = [
  { label: 'Overview', href: '' },
  { label: 'Agents', href: '/agents' },
  { label: 'Skills', href: '/skills' },
  { label: 'Autopilot', href: '/autopilot' },
  { label: 'Connectors', href: '/connectors' },
  { label: 'Team', href: '/team' },
  { label: 'Settings', href: '/settings' },
]

const desktopNavItems = [
  { label: 'Workspace', href: '/w/local' },
  { label: 'Agents', href: '/u/local/agents' },
  { label: 'Skills', href: '/w/local?settings=skills' },
  { label: 'Connectors', href: '/w/local?settings=connectors' },
  { label: 'Providers', href: '/w/local?settings=providers' },
  { label: 'Settings', href: '/w/local?settings=appearance' },
]

type DashboardIconProps = {
  className?: string
}

function ArrowUpRightIcon({ className }: DashboardIconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5 11 11 5M6 5h5v5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  )
}

function MenuIcon({ className }: DashboardIconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 6h12M4 10h12M4 14h12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.75"
      />
    </svg>
  )
}

function CloseIcon({ className }: DashboardIconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m5 5 10 10M15 5 5 15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.75"
      />
    </svg>
  )
}

export function DashboardNav({
  slug,
  desktopMode = false,
  displayLabel,
}: {
  slug: string
  desktopMode?: boolean
  displayLabel?: string
}) {
  const pathname = usePathname()
  const base = `/u/${slug}`
  const workspaceHref = `/w/${slug}`
  const navItems = desktopMode ? desktopNavItems : webNavItems
  const [menuState, setMenuState] = useState<{ open: boolean; pathname: string }>({
    open: false,
    pathname,
  })
  const menuRef = useRef<HTMLDivElement>(null)

  const mobileMenuOpen = menuState.open && menuState.pathname === pathname

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

  return (
    <div ref={menuRef} className="relative">
      <nav className="glass-bar flex h-14 items-center rounded-2xl border-border/40 bg-card/65 pl-5 pr-2 text-card-foreground shadow-none">
        {/* Left - brand + slug */}
        <div className="flex items-center">
          <Link
            href="/"
            className="type-display mr-2 text-base font-semibold"
          >
            Archē
          </Link>
          <span className="text-sm text-muted-foreground">/&nbsp;{displayLabel ?? slug}</span>
        </div>

        {/* Center - nav items (hidden on small screens) */}
        <div className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {navItems.map((item) => {
            const href = item.href.startsWith('/w/') ? item.href : `${base}${item.href}`
            const isActive =
              !item.href.startsWith('/w/') && item.href === ''
                ? pathname === base
                : pathname.startsWith(href)

            return (
              <Link
                key={item.label}
                href={href}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>

        {/* Right - workspace link (hidden on small screens) + mobile hamburger */}
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={workspaceHref}
            className="hidden items-center gap-1.5 rounded-lg bg-foreground/10 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/15 md:inline-flex"
          >
            Open Workspace
            <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </Link>

          <button
            type="button"
            onClick={() => setMenuState({ open: !mobileMenuOpen, pathname })}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground md:hidden"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileMenuOpen ? (
              <CloseIcon className="h-5 w-5" />
            ) : (
              <MenuIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      </nav>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="absolute inset-x-0 top-full z-40 mt-2 rounded-xl border border-border/40 bg-card/95 p-2 shadow-lg backdrop-blur-lg md:hidden">
          {navItems.map((item) => {
            const href = item.href.startsWith('/w/') ? item.href : `${base}${item.href}`
            const isActive =
              !item.href.startsWith('/w/') && item.href === ''
                ? pathname === base
                : pathname.startsWith(href)

            return (
              <Link
                key={item.label}
                href={href}
                className={`block rounded-lg px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
                }`}
              >
                {item.label}
              </Link>
            )
          })}

          <div className="my-1.5 h-px bg-border/40" />

          <Link
            href={workspaceHref}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
          >
            Open Workspace
            <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  )
}

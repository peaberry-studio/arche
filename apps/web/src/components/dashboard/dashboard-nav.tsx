'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowUpRight } from '@phosphor-icons/react'

const navItems = [
  { label: 'Overview', href: '' },
  { label: 'Agents', href: '/agents' },
  { label: 'Connectors', href: '/connectors' },
  { label: 'Team', href: '/team' },
  { label: 'Settings', href: '/settings/security' },
]

export function DashboardNav({ slug }: { slug: string }) {
  const pathname = usePathname()
  const base = `/u/${slug}`
  const workspaceHref = `/w/${slug}`

  return (
    <nav className="glass-bar flex h-14 items-center rounded-2xl border-border/40 bg-card/65 pl-5 pr-2 text-card-foreground shadow-none">
      {/* Left – brand + slug */}
      <div className="flex items-center">
        <Link
          href="/"
          className="type-display mr-2 text-base font-semibold"
        >
          Archē
        </Link>
        <span className="text-sm text-muted-foreground">/&nbsp;{slug}</span>
      </div>

      {/* Center – nav items */}
      <div className="flex flex-1 items-center justify-center gap-1">
        {navItems.map((item) => {
          const href = `${base}${item.href}`
          const isActive =
            item.href === ''
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

      {/* Right – workspace link */}
      <Link
        href={workspaceHref}
        className="inline-flex items-center gap-1.5 rounded-lg bg-foreground/10 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/15"
      >
        Open Workspace
        <ArrowUpRight size={14} weight="bold" />
      </Link>
    </nav>
  )
}

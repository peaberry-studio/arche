'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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

  return (
    <nav className="glass-bar flex h-11 items-center gap-1 rounded-2xl px-4 text-card-foreground">
      <Link
        href="/"
        className="mr-2 font-[family-name:var(--font-display)] text-sm font-semibold"
      >
        Arche
      </Link>
      <span className="mr-3 text-xs text-muted-foreground">/&nbsp;{slug}</span>

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
                ? 'bg-muted/50 text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'

type ConnectorListItem = {
  id: string
  type: string
  name: string
  enabled: boolean
}

type ConnectorsWidgetProps = {
  slug: string
}

export function ConnectorsWidget({ slug }: ConnectorsWidgetProps) {
  const [connectors, setConnectors] = useState<ConnectorListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadConnectors() {
      try {
        const response = await fetch(`/api/u/${slug}/connectors`, { cache: 'no-store' })
        const data = (await response.json().catch(() => null)) as { connectors?: ConnectorListItem[] } | null
        if (!response.ok || cancelled) return
        const enabledConnectors = (data?.connectors ?? []).filter((connector) => connector.enabled)
        setConnectors(enabledConnectors.slice(0, 4))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadConnectors().catch(() => {
      if (!cancelled) setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [slug])

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-lg border border-border/60 bg-card/40" />
        ))}
      </div>
    )
  }

  if (connectors.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-6 text-center">
        <p className="text-sm font-medium text-foreground">No connectors enabled</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect your first integration to unlock MCP tools.
        </p>
        <div className="mt-4">
          <Button size="sm" asChild>
            <Link href={`/u/${slug}/connectors`}>Add your first connector</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {connectors.map((connector) => (
        <div
          key={connector.id}
          className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-4 py-3"
        >
          <span className="text-sm text-foreground">{connector.name}</span>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{connector.type}</span>
        </div>
      ))}
    </div>
  )
}

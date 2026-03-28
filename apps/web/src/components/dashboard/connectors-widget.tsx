'use client'

import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'

type ConnectorListItem = {
  id: string
  type: string
  name: string
  enabled: boolean
  status: 'ready' | 'pending' | 'disabled'
}

type ConnectorsWidgetProps = {
  slug: string
}

function statusBadge(status: ConnectorListItem['status']) {
  switch (status) {
    case 'ready':
      return <Badge variant="success">Working</Badge>
    case 'pending':
      return <Badge variant="warning">Pending</Badge>
    default:
      return <Badge variant="outline">Offline</Badge>
  }
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
        setConnectors((data?.connectors ?? []).slice(0, 4))
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
          <div key={index} className="h-12 animate-pulse rounded-lg glass-panel" />
        ))}
      </div>
    )
  }

  if (connectors.length === 0) {
    return (
      <div className="glass-panel rounded-xl p-6 text-center">
        <p className="text-sm font-medium text-foreground">No connectors enabled</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect integrations to unlock MCP tools.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {connectors.map((connector) => (
        <div
          key={connector.id}
          className="glass-panel flex items-center gap-3 rounded-lg px-4 py-3"
        >
          <span
            className={`flex h-2 w-2 shrink-0 rounded-full ${
              connector.status === 'ready'
                ? 'bg-emerald-500'
                : connector.status === 'pending'
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
            }`}
          />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{connector.name}</span>
          <span className="shrink-0">{statusBadge(connector.status)}</span>
        </div>
      ))}
    </div>
  )
}

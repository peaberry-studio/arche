'use client'

import { useEffect, useState } from 'react'

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
          <span className="flex-1 text-sm text-foreground">{connector.name}</span>
          <span className="text-xs text-muted-foreground">
            {connector.status === 'ready'
              ? 'Working'
              : connector.status === 'pending'
                ? 'Pending'
                : 'Not working'}
          </span>
          <span className="rounded-md bg-foreground/5 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {connector.type}
          </span>
        </div>
      ))}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'

export type AgentListItem = {
  id: string
  displayName: string
  description?: string
  model?: string
  temperature?: number
  isPrimary: boolean
}

type UseAgentsCatalogResult = {
  agents: AgentListItem[]
  isLoading: boolean
  loadError: string | null
  reload: () => Promise<void>
}

export function useAgentsCatalog(slug: string): UseAgentsCatalogResult {
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await fetch(`/api/u/${slug}/agents`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as {
        agents?: AgentListItem[]
        error?: string
      } | null

      if (!response.ok || !data) {
        setLoadError(data?.error ?? 'load_failed')
        return
      }

      setAgents(data.agents ?? [])
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void reload()
  }, [reload])

  return {
    agents,
    isLoading,
    loadError,
    reload,
  }
}

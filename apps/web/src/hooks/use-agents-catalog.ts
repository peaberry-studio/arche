'use client'

import { useCallback, useEffect, useState } from 'react'

export type AgentListItem = {
  id: string
  displayName: string
  description?: string
  defaultModel?: string
  model?: string
  resolvedModel?: string
  temperature?: number
  usesDefaultModel: boolean
  isPrimary: boolean
}

type UseAgentsCatalogResult = {
  agents: AgentListItem[]
  defaultModel?: string
  hash?: string
  isLoading: boolean
  loadError: string | null
  reload: () => Promise<void>
}

export function useAgentsCatalog(slug: string): UseAgentsCatalogResult {
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [defaultModel, setDefaultModel] = useState<string | undefined>()
  const [hash, setHash] = useState<string | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await fetch(`/api/u/${slug}/agents`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as {
        agents?: AgentListItem[]
        defaultModel?: string
        error?: string
        hash?: string
      } | null

      if (!response.ok || !data) {
        setLoadError(data?.error ?? 'load_failed')
        return
      }

      setAgents(data.agents ?? [])
      setDefaultModel(data.defaultModel)
      setHash(data.hash)
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
    defaultModel,
    hash,
    isLoading,
    loadError,
    reload,
  }
}

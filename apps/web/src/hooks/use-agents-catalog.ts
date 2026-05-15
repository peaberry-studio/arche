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

async function fetchAgentsCatalog(slug: string): Promise<{
  agents?: AgentListItem[]
  defaultModel?: string
  error?: string
  hash?: string
  ok: boolean
}> {
  const response = await fetch(`/api/u/${slug}/agents`, { cache: 'no-store' })
  const data = (await response.json().catch(() => null)) as {
    agents?: AgentListItem[]
    defaultModel?: string
    error?: string
    hash?: string
  } | null

  return {
    ...(data ?? {}),
    error: response.ok && data ? data.error : data?.error ?? 'load_failed',
    ok: response.ok && Boolean(data),
  }
}

type AgentsCatalogSnapshot = {
  agents: AgentListItem[]
  defaultModel?: string
  hash?: string
}

function resolveAgentsCatalog(data: Awaited<ReturnType<typeof fetchAgentsCatalog>>):
  | { ok: true; snapshot: AgentsCatalogSnapshot }
  | { ok: false; error: string } {
  if (!data.ok) {
    return { ok: false, error: data.error ?? 'load_failed' }
  }

  return {
    ok: true,
    snapshot: {
      agents: data.agents ?? [],
      defaultModel: data.defaultModel,
      hash: data.hash,
    },
  }
}

export function useAgentsCatalog(slug: string): UseAgentsCatalogResult {
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [defaultModel, setDefaultModel] = useState<string | undefined>()
  const [hash, setHash] = useState<string | undefined>()
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const data = await fetchAgentsCatalog(slug)
      const result = resolveAgentsCatalog(data)

      if (!result.ok) {
        setLoadError(result.error)
        return
      }

      setLoadError(null)
      setAgents(result.snapshot.agents)
      setDefaultModel(result.snapshot.defaultModel)
      setHash(result.snapshot.hash)
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    let cancelled = false

    async function loadInitialAgents() {
      try {
        const data = await fetchAgentsCatalog(slug)
        if (cancelled) return

        const result = resolveAgentsCatalog(data)
        if (!result.ok) {
          setLoadError(result.error)
          return
        }

        setLoadError(null)
        setAgents(result.snapshot.agents)
        setDefaultModel(result.snapshot.defaultModel)
        setHash(result.snapshot.hash)
      } catch {
        if (!cancelled) {
          setLoadError('network_error')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadInitialAgents()

    return () => {
      cancelled = true
    }
  }, [slug])

  return {
    agents,
    defaultModel,
    hash,
    isLoading,
    loadError,
    reload,
  }
}

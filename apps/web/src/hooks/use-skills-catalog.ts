'use client'

import { useCallback, useEffect, useState } from 'react'

export type SkillListItem = {
  assignedAgentIds: string[]
  description: string
  hasResources: boolean
  name: string
  resourcePaths: string[]
}

type UseSkillsCatalogResult = {
  hash?: string | null
  isLoading: boolean
  loadError: string | null
  reload: () => Promise<void>
  skills: SkillListItem[]
}

export function useSkillsCatalog(slug: string): UseSkillsCatalogResult {
  const [skills, setSkills] = useState<SkillListItem[]>([])
  const [hash, setHash] = useState<string | null>()
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await fetch(`/api/u/${slug}/skills`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as {
        error?: string
        hash?: string | null
        skills?: SkillListItem[]
      } | null

      if (!response.ok || !data) {
        setLoadError(data?.error ?? 'load_failed')
        return
      }

      setSkills(data.skills ?? [])
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
    hash,
    skills,
    isLoading,
    loadError,
    reload,
  }
}

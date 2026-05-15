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

async function fetchSkillsCatalog(slug: string): Promise<{
  error?: string
  hash?: string | null
  ok: boolean
  skills?: SkillListItem[]
}> {
  const response = await fetch(`/api/u/${slug}/skills`, { cache: 'no-store' })
  const data = (await response.json().catch(() => null)) as {
    error?: string
    hash?: string | null
    skills?: SkillListItem[]
  } | null

  return {
    ...(data ?? {}),
    error: response.ok && data ? data.error : data?.error ?? 'load_failed',
    ok: response.ok && Boolean(data),
  }
}

type SkillsCatalogSnapshot = {
  hash?: string | null
  skills: SkillListItem[]
}

function resolveSkillsCatalog(data: Awaited<ReturnType<typeof fetchSkillsCatalog>>):
  | { ok: true; snapshot: SkillsCatalogSnapshot }
  | { ok: false; error: string } {
  if (!data.ok) {
    return { ok: false, error: data.error ?? 'load_failed' }
  }

  return {
    ok: true,
    snapshot: {
      hash: data.hash,
      skills: data.skills ?? [],
    },
  }
}

export function useSkillsCatalog(slug: string): UseSkillsCatalogResult {
  const [skills, setSkills] = useState<SkillListItem[]>([])
  const [hash, setHash] = useState<string | null>()
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const data = await fetchSkillsCatalog(slug)
      const result = resolveSkillsCatalog(data)

      if (!result.ok) {
        setLoadError(result.error)
        return
      }

      setLoadError(null)
      setSkills(result.snapshot.skills)
      setHash(result.snapshot.hash)
    } catch {
      setLoadError('network_error')
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    let cancelled = false

    async function loadInitialSkills() {
      try {
        const data = await fetchSkillsCatalog(slug)
        if (cancelled) return

        const result = resolveSkillsCatalog(data)
        if (!result.ok) {
          setLoadError(result.error)
          return
        }

        setLoadError(null)
        setSkills(result.snapshot.skills)
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

    void loadInitialSkills()

    return () => {
      cancelled = true
    }
  }, [slug])

  return {
    hash,
    skills,
    isLoading,
    loadError,
    reload,
  }
}

'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

import { AgentForm } from '@/components/agents/agent-form'
import { getWorkspaceCatalogHref } from '@/lib/workspace-hrefs'

type WebAgentFormProps = {
  agentId?: string
  backHref?: string
  mode: 'create' | 'edit'
  slug: string
}

export function WebAgentForm({ slug, mode, agentId, backHref }: WebAgentFormProps) {
  const router = useRouter()
  const listHref = backHref ?? getWorkspaceCatalogHref(slug, 'agents')

  const handleCancel = useCallback(() => {
    router.push(listHref)
  }, [listHref, router])

  const handleDelete = useCallback(() => {
    router.push(listHref)
  }, [listHref, router])

  const handleSave = useCallback(async ({ mode: currentMode }: { agentId: string; mode: 'create' | 'edit' }) => {
    if (currentMode === 'create') {
      router.push(listHref)
    }
  }, [listHref, router])

  return (
    <AgentForm
      slug={slug}
      mode={mode}
      agentId={agentId}
      onCancel={handleCancel}
      onDeleted={handleDelete}
      onSaved={handleSave}
    />
  )
}

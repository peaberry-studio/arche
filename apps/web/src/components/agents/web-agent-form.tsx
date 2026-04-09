'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

import { AgentForm } from '@/components/agents/agent-form'

type WebAgentFormProps = {
  agentId?: string
  mode: 'create' | 'edit'
  slug: string
}

export function WebAgentForm({ slug, mode, agentId }: WebAgentFormProps) {
  const router = useRouter()

  const handleCancel = useCallback(() => {
    router.push(`/u/${slug}/agents`)
  }, [router, slug])

  const handleDelete = useCallback(() => {
    router.push(`/u/${slug}/agents`)
  }, [router, slug])

  const handleSave = useCallback(async ({ mode: currentMode }: { agentId: string; mode: 'create' | 'edit' }) => {
    if (currentMode === 'create') {
      router.push(`/u/${slug}/agents`)
    }
  }, [router, slug])

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

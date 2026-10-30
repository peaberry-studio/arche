'use client'

import { useCallback } from 'react'

import { AgentForm } from '@/components/agents/agent-form'
import { getWorkspaceCatalogHref } from '@/lib/workspace-hrefs'

type WebAgentFormProps = {
  agentId?: string
  backHref?: string
  mode: 'create' | 'edit'
  slug: string
}

export function WebAgentForm({ slug, mode, agentId, backHref }: WebAgentFormProps) {
  const listHref = backHref ?? getWorkspaceCatalogHref(slug, 'agents')

  // The catalog views are client state of the workspace page (see
  // WorkspaceCatalogView), so the list is shown by updating the history entry.
  // A router navigation would refetch the page, and a concurrent refresh of
  // the form URL (e.g. after the save) could land last and undo it.
  const showList = useCallback(() => {
    window.history.pushState(null, '', listHref)
  }, [listHref])

  const handleSave = useCallback(async ({ mode: currentMode }: { agentId: string; mode: 'create' | 'edit' }) => {
    if (currentMode === 'create') showList()
  }, [showList])

  return (
    <AgentForm
      slug={slug}
      mode={mode}
      agentId={agentId}
      onCancel={showList}
      onDeleted={showList}
      onSaved={handleSave}
    />
  )
}

'use client'

import { useCallback } from 'react'

import { SkillForm } from '@/components/skills/skill-form'
import { getWorkspaceCatalogHref } from '@/lib/workspace-hrefs'

type WebSkillFormProps = {
  backHref?: string
  mode: 'create' | 'edit'
  skillName?: string
  slug: string
}

export function WebSkillForm({ slug, mode, skillName, backHref }: WebSkillFormProps) {
  const listHref = backHref ?? getWorkspaceCatalogHref(slug, 'skills')

  // Same as WebAgentForm: the catalog views are client state of the workspace
  // page, so the list is shown by updating the history entry instead of a
  // router navigation that refetches the page and can be undone by a late
  // refresh of the form URL.
  const showList = useCallback(() => {
    window.history.pushState(null, '', listHref)
  }, [listHref])

  const handleSave = useCallback(async ({ mode: currentMode }: { mode: 'create' | 'edit'; name: string }) => {
    if (currentMode === 'create') showList()
  }, [showList])

  return (
    <SkillForm
      slug={slug}
      mode={mode}
      skillName={skillName}
      onCancel={showList}
      onDeleted={showList}
      onSaved={handleSave}
    />
  )
}

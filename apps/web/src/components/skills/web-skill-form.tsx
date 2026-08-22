'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

import { SkillForm } from '@/components/skills/skill-form'
import { getWorkspaceCatalogHref } from '@/lib/workspace-hrefs'

type WebSkillFormProps = {
  backHref?: string
  mode: 'create' | 'edit'
  skillName?: string
  slug: string
}

export function WebSkillForm({ slug, mode, skillName, backHref }: WebSkillFormProps) {
  const router = useRouter()
  const listHref = backHref ?? getWorkspaceCatalogHref(slug, 'skills')

  const handleCancel = useCallback(() => {
    router.push(listHref)
  }, [listHref, router])

  const handleDelete = useCallback(() => {
    router.push(listHref)
  }, [listHref, router])

  const handleSave = useCallback(async ({ mode: currentMode }: { mode: 'create' | 'edit'; name: string }) => {
    if (currentMode === 'create') {
      router.push(listHref)
    }
  }, [listHref, router])

  return (
    <SkillForm
      slug={slug}
      mode={mode}
      skillName={skillName}
      onCancel={handleCancel}
      onDeleted={handleDelete}
      onSaved={handleSave}
    />
  )
}

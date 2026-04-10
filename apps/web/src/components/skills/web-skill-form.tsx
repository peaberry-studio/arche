'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

import { SkillForm } from '@/components/skills/skill-form'

type WebSkillFormProps = {
  mode: 'create' | 'edit'
  skillName?: string
  slug: string
}

export function WebSkillForm({ slug, mode, skillName }: WebSkillFormProps) {
  const router = useRouter()

  const handleCancel = useCallback(() => {
    router.push(`/u/${slug}/skills`)
  }, [router, slug])

  const handleDelete = useCallback(() => {
    router.push(`/u/${slug}/skills`)
  }, [router, slug])

  const handleSave = useCallback(async ({ mode: currentMode }: { mode: 'create' | 'edit'; name: string }) => {
    if (currentMode === 'create') {
      router.push(`/u/${slug}/skills`)
    }
  }, [router, slug])

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

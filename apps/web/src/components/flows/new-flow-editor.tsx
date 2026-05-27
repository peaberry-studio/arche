'use client'

import { useEffect, useRef, useState } from 'react'

import { FlowEditor } from '@/components/flows/flow-editor'
import type { FlowTemplate } from '@/lib/flows/import-export'
import { consumeFlowTemplateDraft } from '@/lib/flows/template-session'

type NewFlowEditorProps = {
  slug: string
}

export function NewFlowEditor({ slug }: NewFlowEditorProps) {
  const consumedTemplateRef = useRef(false)
  const [initialTemplate, setInitialTemplate] = useState<FlowTemplate | null>(null)

  useEffect(() => {
    if (consumedTemplateRef.current) return

    consumedTemplateRef.current = true
    setInitialTemplate(consumeFlowTemplateDraft())
  }, [])

  return <FlowEditor slug={slug} mode="create" initialTemplate={initialTemplate ?? undefined} />
}

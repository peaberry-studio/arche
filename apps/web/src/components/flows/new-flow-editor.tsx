'use client'

import { useEffect, useRef, useState } from 'react'

import { FlowEditor } from '@/components/flows/flow-editor'
import type { FlowTemplate } from '@/lib/flows/import-export'
import { consumeFlowTemplateDraft } from '@/lib/flows/template-session'

type NewFlowEditorProps = {
  slackIntegrationAvailable?: boolean
  slug: string
  teamVisibilityAvailable?: boolean
}

export function NewFlowEditor({ slackIntegrationAvailable, slug, teamVisibilityAvailable }: NewFlowEditorProps) {
  const consumedTemplateRef = useRef(false)
  const [initialTemplate, setInitialTemplate] = useState<FlowTemplate | null>(null)

  useEffect(() => {
    if (consumedTemplateRef.current) return

    consumedTemplateRef.current = true
    setInitialTemplate(consumeFlowTemplateDraft())
  }, [])

  return (
    <FlowEditor
      slug={slug}
      mode="create"
      initialTemplate={initialTemplate ?? undefined}
      slackIntegrationAvailable={slackIntegrationAvailable}
      teamVisibilityAvailable={teamVisibilityAvailable}
    />
  )
}

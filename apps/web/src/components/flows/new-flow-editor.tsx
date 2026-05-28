'use client'

import { useEffect, useRef, useState } from 'react'

import { FlowEditor } from '@/components/flows/flow-editor'
import type { FlowTemplate } from '@/lib/flows/import-export'
import { consumeFlowTemplateDraft } from '@/lib/flows/template-session'

type NewFlowEditorProps = {
  buildFlowHref?: (flowId: string) => string
  flowListHref?: string
  slackIntegrationAvailable?: boolean
  slug: string
  teamVisibilityAvailable?: boolean
}

export function NewFlowEditor({
  buildFlowHref,
  flowListHref,
  slackIntegrationAvailable,
  slug,
  teamVisibilityAvailable,
}: NewFlowEditorProps) {
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
      buildFlowHref={buildFlowHref}
      flowListHref={flowListHref}
      initialTemplate={initialTemplate ?? undefined}
      slackIntegrationAvailable={slackIntegrationAvailable}
      teamVisibilityAvailable={teamVisibilityAvailable}
    />
  )
}

'use client'

import { useState } from 'react'

import { FlowEditor } from '@/components/flows/flow-editor'
import type { FlowTemplate } from '@/lib/flows/import-export'
import { consumeFlowTemplateDraft } from '@/lib/flows/template-session'

type NewFlowEditorProps = {
  slug: string
}

export function NewFlowEditor({ slug }: NewFlowEditorProps) {
  const [initialTemplate] = useState<FlowTemplate | null>(() => consumeFlowTemplateDraft())

  return <FlowEditor slug={slug} mode="create" initialTemplate={initialTemplate ?? undefined} />
}

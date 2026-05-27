'use client'

import { useCallback } from 'react'
import Link from 'next/link'

import { FlowsPage } from '@/components/flows/flows-page'
import { Button } from '@/components/ui/button'
import { getDesktopFlowsHref } from '@/lib/runtime/desktop/current-vault'

type FlowsSettingsPanelProps = {
  slug: string
}

export function FlowsSettingsPanel({ slug }: FlowsSettingsPanelProps) {
  const buildCreateHref = useCallback(() => getDesktopFlowsHref(slug, 'new'), [slug])
  const buildEditHref = useCallback((flowId: string) => getDesktopFlowsHref(slug, 'edit', flowId), [slug])
  const buildHistoryHref = useCallback((flowId: string) => getDesktopFlowsHref(slug, 'runs', flowId), [slug])

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-lg font-medium text-foreground">Flows</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse your desktop automations. Creating, importing, or editing a flow opens the full-screen editor.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild type="button" variant="outline">
          <Link href={buildCreateHref()}>Import flow</Link>
        </Button>
        <Button asChild type="button" variant="outline">
          <Link href={buildCreateHref()}>Create flow</Link>
        </Button>
      </div>

      <FlowsPage
        slug={slug}
        buildCreateHref={buildCreateHref}
        buildEditHref={buildEditHref}
        buildHistoryHref={buildHistoryHref}
        hideHeader
        navigateToHistoryOnRun
      />
    </section>
  )
}

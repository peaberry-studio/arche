'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ClockCounterClockwise, X } from '@phosphor-icons/react'

import { FlowEditor } from '@/components/flows/flow-editor'
import { FlowRunHistoryView } from '@/components/flows/flow-run-history-view'
import { FlowsPage } from '@/components/flows/flows-page'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { getDesktopFlowsHref, type DesktopFlowsView } from '@/lib/runtime/desktop/current-vault'

type DesktopFlowsDialogProps = {
  currentView: DesktopFlowsView | null
  flowId: string | null
  slackIntegrationAvailable?: boolean
  slug: string
  teamVisibilityAvailable?: boolean
}

const VIEW_LABELS: Record<DesktopFlowsView, { description: string; title: string }> = {
  edit: {
    description: 'Adjust nodes, routing, sharing, and schedule.',
    title: 'Edit flow',
  },
  list: {
    description: 'Create, run, and manage desktop automations.',
    title: 'Flows',
  },
  new: {
    description: 'Design a multi-step automation with agents and human review.',
    title: 'Create flow',
  },
  runs: {
    description: 'Inspect every execution and active run state.',
    title: 'Run history',
  },
}

export function DesktopFlowsDialog({
  currentView,
  flowId,
  slackIntegrationAvailable = false,
  slug,
  teamVisibilityAvailable = false,
}: DesktopFlowsDialogProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeLabel = currentView ? VIEW_LABELS[currentView] : VIEW_LABELS.list

  const updateView = useCallback(
    (view: DesktopFlowsView | null, nextFlowId?: string | null, runId?: string | null) => {
      const params = new URLSearchParams(searchParams.toString())

      if (view) {
        params.delete('settings')
        params.set('flows', view)
        if (nextFlowId) {
          params.set('flowId', nextFlowId)
        } else {
          params.delete('flowId')
        }
        if (runId) {
          params.set('run', runId)
        } else {
          params.delete('run')
        }
      } else {
        params.delete('flows')
        params.delete('flowId')
        params.delete('run')
      }

      const next = params.toString()
      router.replace(next ? `${pathname}?${next}` : pathname)
    },
    [pathname, router, searchParams],
  )

  const buildCreateHref = useCallback(() => getDesktopFlowsHref(slug, 'new'), [slug])
  const buildEditHref = useCallback((id: string) => getDesktopFlowsHref(slug, 'edit', id), [slug])
  const buildHistoryHref = useCallback((id: string, runId?: string) => getDesktopFlowsHref(slug, 'runs', id, runId), [slug])
  const listHref = getDesktopFlowsHref(slug, 'list')

  function renderMissingFlow() {
    return (
      <div className="rounded-xl border border-border/60 bg-card/40 p-5">
        <p className="text-sm font-semibold text-foreground">Missing flow</p>
        <p className="mt-1 text-sm text-muted-foreground">Open a flow from the list to continue.</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={listHref}>Back to flows</Link>
        </Button>
      </div>
    )
  }

  function renderBackLink(label = 'Back to flows') {
    return (
      <Link href={listHref} className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground">
        &larr; {label}
      </Link>
    )
  }

  function renderContent() {
    switch (currentView) {
      case 'list':
        return (
          <FlowsPage
            slug={slug}
            buildCreateHref={buildCreateHref}
            buildEditHref={buildEditHref}
            buildHistoryHref={buildHistoryHref}
          />
        )
      case 'new':
        return (
          <div className="space-y-8">
            {renderBackLink()}
            <FlowEditor
              slug={slug}
              mode="create"
              buildFlowHref={buildEditHref}
              flowListHref={listHref}
              slackIntegrationAvailable={slackIntegrationAvailable}
              teamVisibilityAvailable={teamVisibilityAvailable}
            />
          </div>
        )
      case 'edit':
        if (!flowId) return renderMissingFlow()
        return (
          <div className="space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {renderBackLink()}
              <Link
                href={buildHistoryHref(flowId)}
                className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ClockCounterClockwise size={14} weight="bold" />
                Run history
              </Link>
            </div>
            <FlowEditor
              slug={slug}
              mode="edit"
              flowId={flowId}
              buildFlowHref={buildEditHref}
              flowListHref={listHref}
              slackIntegrationAvailable={slackIntegrationAvailable}
              teamVisibilityAvailable={teamVisibilityAvailable}
            />
          </div>
        )
      case 'runs':
        if (!flowId) return renderMissingFlow()
        return (
          <div className="space-y-6">
            {renderBackLink()}
            <FlowRunHistoryView slug={slug} flowId={flowId} editHref={buildEditHref(flowId)} />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <Dialog open={Boolean(currentView)} onOpenChange={(open) => !open && updateView(null)}>
      <DialogContent showCloseButton={false} className="h-[90vh] max-h-[94vh] w-[96vw] max-w-[96rem] overflow-hidden p-0">
        <DialogTitle className="sr-only">Desktop flows</DialogTitle>
        <DialogDescription className="sr-only">
          Create, run, and manage desktop workspace flows.
        </DialogDescription>

        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
            <div>
              <p className="text-sm font-medium text-foreground">{activeLabel.title}</p>
              <p className="text-xs text-muted-foreground">{activeLabel.description}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => updateView(null)}
              aria-label="Close flows"
            >
              <X size={16} weight="bold" />
            </Button>
          </div>

          <div className="scrollbar-custom min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {renderContent()}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

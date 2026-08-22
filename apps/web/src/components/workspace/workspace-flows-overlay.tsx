'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ClockCounterClockwise, X } from '@phosphor-icons/react'

import { FlowEditor } from '@/components/flows/flow-editor'
import { FlowRunHistoryView } from '@/components/flows/flow-run-history-view'
import { FlowsPage } from '@/components/flows/flows-page'
import { NewFlowEditor } from '@/components/flows/new-flow-editor'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { getWorkspaceFlowsHref, type WorkspaceFlowsView } from '@/lib/workspace-hrefs'
import { cn } from '@/lib/utils'

type WorkspaceFlowsOverlayProps = {
  macDesktopWindowInset?: boolean
  slackIntegrationAvailable?: boolean
  slug: string
  teamVisibilityAvailable?: boolean
}

const VIEW_LABELS: Record<WorkspaceFlowsView, { description: string; title: string }> = {
  edit: {
    description: 'Adjust nodes, routing, sharing, and schedule.',
    title: 'Edit flow',
  },
  list: {
    description: 'Create, run, and manage automations.',
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

const VIEWS: WorkspaceFlowsView[] = ['list', 'new', 'edit', 'runs']

export function WorkspaceFlowsOverlay({
  macDesktopWindowInset = false,
  slackIntegrationAvailable = false,
  slug,
  teamVisibilityAvailable = false,
}: WorkspaceFlowsOverlayProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const flowsParam = searchParams.get('flows')
  const currentView: WorkspaceFlowsView | null =
    flowsParam && (VIEWS as string[]).includes(flowsParam) ? (flowsParam as WorkspaceFlowsView) : null
  const flowId = searchParams.get('flowId')
  const sessionId = searchParams.get('session')
  const activeLabel = currentView ? VIEW_LABELS[currentView] : VIEW_LABELS.list

  const updateView = useCallback(
    (view: WorkspaceFlowsView | null, nextFlowId?: string | null) => {
      const params = new URLSearchParams(searchParams.toString())

      if (view) {
        params.delete('settings')
        params.set('flows', view)
        if (nextFlowId) {
          params.set('flowId', nextFlowId)
        } else {
          params.delete('flowId')
        }
        params.delete('run')
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

  const buildCreateHref = useCallback(() => getWorkspaceFlowsHref(slug, 'new', null, sessionId), [sessionId, slug])
  const buildEditHref = useCallback((id: string) => getWorkspaceFlowsHref(slug, 'edit', id, sessionId), [sessionId, slug])
  const buildHistoryHref = useCallback((id: string) => getWorkspaceFlowsHref(slug, 'runs', id, sessionId), [sessionId, slug])
  const listHref = getWorkspaceFlowsHref(slug, 'list', null, sessionId)

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
            hideHeader
            navigateToHistoryOnRun
          />
        )
      case 'new':
        return (
          <div className="space-y-8">
            {renderBackLink()}
            <NewFlowEditor
              slug={slug}
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
      <DialogContent
        showCloseButton={false}
        className="inset-0 left-0 top-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0 sm:rounded-none"
      >
        <DialogTitle className="sr-only">Workspace flows</DialogTitle>
        <DialogDescription className="sr-only">
          Create, run, and manage workspace flows.
        </DialogDescription>

        <div className="flex h-full min-h-0 flex-col">
          <div
            className={cn(
              'flex items-center justify-between gap-3 border-b border-border/60 px-6 py-4',
              macDesktopWindowInset && 'desktop-titlebar-drag h-[56px] py-0 pl-[88px]',
            )}
          >
            <div>
              <p className="text-sm font-medium text-foreground">{activeLabel.title}</p>
              <p className="text-xs text-muted-foreground">{activeLabel.description}</p>
            </div>
            <div className={cn('flex items-center gap-2', macDesktopWindowInset && 'desktop-titlebar-no-drag')}>
              {currentView === 'list' ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={buildCreateHref()}>Create flow</Link>
                </Button>
              ) : null}
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
          </div>

          <div className="scrollbar-custom min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {renderContent()}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

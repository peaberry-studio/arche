'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ClockCounterClockwise } from '@phosphor-icons/react'

import { FlowEditor } from '@/components/flows/flow-editor'
import { FlowRunHistoryView } from '@/components/flows/flow-run-history-view'
import { FlowsPage } from '@/components/flows/flows-page'
import { NewFlowEditor } from '@/components/flows/new-flow-editor'
import { Button } from '@/components/ui/button'
import { CatalogDetailFrame, CatalogFrame } from '@/components/workspace/workspace-catalog-view'
import {
  getWorkspaceFlowsHref,
  WORKSPACE_FLOWS_VIEWS,
  type WorkspaceFlowsView,
} from '@/lib/workspace-hrefs'

type WorkspaceFlowsViewProps = {
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

export function WorkspaceFlowsView({
  slackIntegrationAvailable = false,
  slug,
  teamVisibilityAvailable = false,
}: WorkspaceFlowsViewProps) {
  const searchParams = useSearchParams()
  const flowsParam = searchParams.get('flows')
  const currentView: WorkspaceFlowsView | null =
    flowsParam && (WORKSPACE_FLOWS_VIEWS as readonly string[]).includes(flowsParam)
      ? (flowsParam as WorkspaceFlowsView)
      : null
  const flowId = searchParams.get('flowId')
  const sessionId = searchParams.get('session')

  const buildCreateHref = useCallback(
    () => getWorkspaceFlowsHref(slug, 'new', null, sessionId),
    [sessionId, slug],
  )
  const buildEditHref = useCallback(
    (id: string) => getWorkspaceFlowsHref(slug, 'edit', id, sessionId),
    [sessionId, slug],
  )
  const buildHistoryHref = useCallback(
    (id: string) => getWorkspaceFlowsHref(slug, 'runs', id, sessionId),
    [sessionId, slug],
  )
  const listHref = getWorkspaceFlowsHref(slug, 'list', null, sessionId)

  if (!currentView) return null

  if (currentView === 'list') {
    return (
      <CatalogFrame>
        <FlowsPage
          slug={slug}
          buildCreateHref={buildCreateHref}
          buildEditHref={buildEditHref}
          buildHistoryHref={buildHistoryHref}
          navigateToHistoryOnRun
        />
      </CatalogFrame>
    )
  }

  if ((currentView === 'edit' || currentView === 'runs') && !flowId) {
    return (
      <CatalogFrame>
        <div className="rounded-xl border border-border/60 bg-card/40 p-5">
          <p className="text-sm font-semibold text-foreground">Missing flow</p>
          <p className="mt-1 text-sm text-muted-foreground">Open a flow from the list to continue.</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href={listHref}>View flows</Link>
          </Button>
        </div>
      </CatalogFrame>
    )
  }

  const copy = VIEW_LABELS[currentView]

  if (currentView === 'new') {
    return (
      <CatalogDetailFrame title={copy.title} description={copy.description}>
        <NewFlowEditor
          slug={slug}
          buildFlowHref={buildEditHref}
          flowListHref={listHref}
          slackIntegrationAvailable={slackIntegrationAvailable}
          teamVisibilityAvailable={teamVisibilityAvailable}
        />
      </CatalogDetailFrame>
    )
  }

  if (currentView === 'edit') {
    return (
      <CatalogDetailFrame
        title={copy.title}
        description={copy.description}
        aside={
          <Button asChild variant="outline" className="shrink-0 gap-2">
            <Link href={buildHistoryHref(flowId as string)}>
              <ClockCounterClockwise size={14} weight="bold" />
              Run history
            </Link>
          </Button>
        }
      >
        <FlowEditor
          slug={slug}
          mode="edit"
          flowId={flowId as string}
          buildFlowHref={buildEditHref}
          flowListHref={listHref}
          slackIntegrationAvailable={slackIntegrationAvailable}
          teamVisibilityAvailable={teamVisibilityAvailable}
        />
      </CatalogDetailFrame>
    )
  }

  return (
    <CatalogFrame>
      <FlowRunHistoryView slug={slug} flowId={flowId as string} editHref={buildEditHref(flowId as string)} />
    </CatalogFrame>
  )
}

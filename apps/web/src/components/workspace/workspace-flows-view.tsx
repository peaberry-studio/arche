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
import {
  getWorkspaceFlowsHref,
  WORKSPACE_FLOWS_VIEWS,
  type WorkspaceFlowsView,
} from '@/lib/workspace-hrefs'

import { CatalogFrame } from './workspace-catalog-view'

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

function FlowsDetailFrame({
  aside,
  backHref,
  backLabel,
  children,
  description,
  title,
}: {
  aside?: React.ReactNode
  backHref: string
  backLabel: string
  children: React.ReactNode
  description: string
  title: string
}) {
  return (
    <CatalogFrame>
      <div className="space-y-8">
        <div>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <Link
              href={backHref}
              className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              &larr; {backLabel}
            </Link>
            {aside}
          </div>
          <div className="space-y-2">
            <h1 className="type-display text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground">{description}</p>
          </div>
        </div>
        {children}
      </div>
    </CatalogFrame>
  )
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
            <Link href={listHref}>Back to flows</Link>
          </Button>
        </div>
      </CatalogFrame>
    )
  }

  const copy = VIEW_LABELS[currentView]

  if (currentView === 'new') {
    return (
      <FlowsDetailFrame
        backHref={listHref}
        backLabel="Back to flows"
        title={copy.title}
        description={copy.description}
      >
        <NewFlowEditor
          slug={slug}
          buildFlowHref={buildEditHref}
          flowListHref={listHref}
          slackIntegrationAvailable={slackIntegrationAvailable}
          teamVisibilityAvailable={teamVisibilityAvailable}
        />
      </FlowsDetailFrame>
    )
  }

  if (currentView === 'edit') {
    return (
      <FlowsDetailFrame
        backHref={listHref}
        backLabel="Back to flows"
        title={copy.title}
        description={copy.description}
        aside={
          <Link
            href={buildHistoryHref(flowId as string)}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ClockCounterClockwise size={14} weight="bold" />
            Run history
          </Link>
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
      </FlowsDetailFrame>
    )
  }

  return (
    <FlowsDetailFrame
      backHref={listHref}
      backLabel="Back to flows"
      title={copy.title}
      description={copy.description}
    >
      <FlowRunHistoryView slug={slug} flowId={flowId as string} editHref={buildEditHref(flowId as string)} />
    </FlowsDetailFrame>
  )
}

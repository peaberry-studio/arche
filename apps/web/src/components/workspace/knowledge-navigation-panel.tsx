'use client'

import type { ComponentType, ReactNode } from 'react'
import { CaretLineLeft, CaretLineRight, Graph, TreeStructure } from '@phosphor-icons/react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { KnowledgeGraphAgentSource } from '@/lib/kb-graph'
import type { WorkspaceFileNode } from '@/lib/opencode/types'
import { cn } from '@/lib/utils'

import { FileTreePanel } from './file-tree-panel'
import { KnowledgeGraphPanel } from './knowledge-graph-panel'

type OpenKnowledgeFile = {
  content: string
  path: string
}

export type KnowledgeNavigationView = 'tree' | 'graph'

type KnowledgeNavigationPanelProps = {
  activeFilePath: string | null
  agentSources: KnowledgeGraphAgentSource[]
  collapsed?: boolean
  fileNodes: WorkspaceFileNode[]
  headerActions?: ReactNode
  onDownloadFile?: (path: string) => void
  onExportFileDocx?: (path: string) => void
  onExportFilePdf?: (path: string) => void
  onOpenFile: (path: string) => void
  onToggleCollapsed?: () => void
  openFiles: OpenKnowledgeFile[]
  readFile: (path: string) => Promise<{ content: string; type: 'patch' | 'raw'; hash?: string } | null>
  reloadKey: number
  view: KnowledgeNavigationView
  onViewChange: (view: KnowledgeNavigationView) => void
}

type CollapsedViewButtonProps = {
  active: boolean
  icon: ComponentType<{ size?: number; weight?: 'regular' | 'bold' | 'fill'; className?: string }>
  label: string
  onClick: () => void
}

function CollapsedViewButton({ active, icon: Icon, label, onClick }: CollapsedViewButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          aria-label={label}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
            active
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
          )}
        >
          <Icon size={15} weight={active ? 'fill' : 'bold'} className="shrink-0" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function KnowledgeNavigationPanel({
  activeFilePath,
  agentSources,
  collapsed = false,
  fileNodes,
  headerActions,
  onDownloadFile,
  onExportFileDocx,
  onExportFilePdf,
  onOpenFile,
  onToggleCollapsed,
  openFiles,
  readFile,
  reloadKey,
  view,
  onViewChange,
}: KnowledgeNavigationPanelProps) {
  const setView = (next: KnowledgeNavigationView) => {
    onViewChange(next)
  }

  const expandToView = (next: KnowledgeNavigationView) => {
    onViewChange(next)
    onToggleCollapsed?.()
  }

  if (collapsed) {
    return (
      <TooltipProvider delayDuration={150}>
        <div className="flex h-full min-h-0 flex-col items-center py-2 text-card-foreground">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            aria-label="Expand navigation panel"
            title="Expand panel"
          >
            <CaretLineRight size={14} weight="bold" />
          </button>

          <div className="my-2 h-px w-6 bg-border/40" />

          <nav aria-label="Knowledge views" className="flex w-full flex-col items-center gap-1">
            <CollapsedViewButton
              active={view === 'tree'}
              icon={TreeStructure}
              label="Tree"
              onClick={() => expandToView('tree')}
            />
            <CollapsedViewButton
              active={view === 'graph'}
              icon={Graph}
              label="Graph"
              onClick={() => expandToView('graph')}
            />
          </nav>
        </div>
      </TooltipProvider>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-none text-card-foreground">
      <div className="flex shrink-0 items-center justify-between gap-2 pl-3 pr-1.5 py-2">
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border/30 bg-foreground/[0.04] p-[2px]">
          <button
            type="button"
            onClick={() => setView('tree')}
            aria-pressed={view === 'tree'}
            className={cn(
              'flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors',
              view === 'tree'
                ? 'bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <TreeStructure size={11} weight={view === 'tree' ? 'fill' : 'bold'} />
            Tree
          </button>
          <button
            type="button"
            onClick={() => setView('graph')}
            aria-pressed={view === 'graph'}
            className={cn(
              'flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors',
              view === 'graph'
                ? 'bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Graph size={11} weight={view === 'graph' ? 'fill' : 'bold'} />
            Graph
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {headerActions}
          {onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Collapse navigation panel"
              title="Collapse panel"
            >
              <CaretLineLeft size={14} weight="bold" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === 'tree' ? (
          <FileTreePanel
            nodes={fileNodes}
            activePath={activeFilePath}
            onSelect={onOpenFile}
            onDownloadFile={onDownloadFile}
            onExportFileDocx={onExportFileDocx}
            onExportFilePdf={onExportFilePdf}
            hideHeader
          />
        ) : (
          <KnowledgeGraphPanel
            activeFilePath={activeFilePath}
            agentSources={agentSources}
            fileNodes={fileNodes}
            onOpenFile={onOpenFile}
            openFiles={openFiles}
            readFile={readFile}
            reloadKey={reloadKey}
          />
        )}
      </div>
    </div>
  )
}

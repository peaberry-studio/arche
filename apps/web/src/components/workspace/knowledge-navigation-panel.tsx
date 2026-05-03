'use client'

import { useState, type ReactNode } from 'react'
import { Graph, TreeStructure } from '@phosphor-icons/react'

import { cn } from '@/lib/utils'
import type { KnowledgeGraphAgentSource } from '@/lib/kb-graph'
import type { WorkspaceFileNode } from '@/lib/opencode/types'

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
  fileNodes: WorkspaceFileNode[]
  headerActions?: ReactNode
  onDownloadFile?: (path: string) => void
  onOpenFile: (path: string) => void
  openFiles: OpenKnowledgeFile[]
  readFile: (path: string) => Promise<{ content: string; type: 'patch' | 'raw'; hash?: string } | null>
  reloadKey: number
  view?: KnowledgeNavigationView
  onViewChange?: (view: KnowledgeNavigationView) => void
}

export function KnowledgeNavigationPanel({
  activeFilePath,
  agentSources,
  fileNodes,
  headerActions,
  onDownloadFile,
  onOpenFile,
  openFiles,
  readFile,
  reloadKey,
  view: controlledView,
  onViewChange,
}: KnowledgeNavigationPanelProps) {
  const [internalView, setInternalView] = useState<KnowledgeNavigationView>('tree')
  const view = controlledView ?? internalView
  const setView = (next: KnowledgeNavigationView) => {
    if (onViewChange) onViewChange(next)
    else setInternalView(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-none text-card-foreground">
      <div className="flex shrink-0 items-center justify-between gap-2 pl-1.5 pr-1.5 py-2">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setView('tree')}
            aria-pressed={view === 'tree'}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors',
              view === 'tree'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground/80'
            )}
          >
            <TreeStructure size={12} weight={view === 'tree' ? 'fill' : 'bold'} />
            Tree
          </button>
          <button
            type="button"
            onClick={() => setView('graph')}
            aria-pressed={view === 'graph'}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors',
              view === 'graph'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground/80'
            )}
          >
            <Graph size={12} weight={view === 'graph' ? 'fill' : 'bold'} />
            Graph
          </button>
        </div>

        {headerActions ? (
          <div className="flex shrink-0 items-center">{headerActions}</div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === 'tree' ? (
          <FileTreePanel
            nodes={fileNodes}
            activePath={activeFilePath}
            onSelect={onOpenFile}
            onDownloadFile={onDownloadFile}
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

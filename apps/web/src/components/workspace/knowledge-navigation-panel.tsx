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
}: KnowledgeNavigationPanelProps) {
  const [view, setView] = useState<'tree' | 'graph'>('tree')

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-foreground/[0.03] text-card-foreground">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/30 px-2 py-2">
        <div className="inline-flex h-8 items-center rounded-lg bg-foreground/[0.05] p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setView('tree')}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 font-medium transition-colors',
              view === 'tree'
                ? 'bg-background text-foreground/85'
                : 'text-muted-foreground hover:text-foreground/80'
            )}
            aria-pressed={view === 'tree'}
          >
            <TreeStructure size={12} weight={view === 'tree' ? 'fill' : 'bold'} />
            Tree
          </button>
          <button
            type="button"
            onClick={() => setView('graph')}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 font-medium transition-colors',
              view === 'graph'
                ? 'bg-background text-foreground/85'
                : 'text-muted-foreground hover:text-foreground/80'
            )}
            aria-pressed={view === 'graph'}
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

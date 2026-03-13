"use client";

import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { File, Plus } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceFileNode } from "@/lib/opencode/types";

import { FileTreeContextMenu } from "./file-tree-context-menu";
import { FileTree } from "./file-tree";

type FileTreePanelProps = {
  nodes: WorkspaceFileNode[];
  activePath?: string | null;
  onSelect: (path: string) => void;
  onDownloadFile?: (path: string) => void;
  hideHeader?: boolean;
  query?: string;
};

type FlatFile = { name: string; path: string };
type FileContextMenuState = FlatFile & { x: number; y: number };

function flattenFiles(nodes: WorkspaceFileNode[]): FlatFile[] {
  const result: FlatFile[] = [];
  nodes.forEach((node) => {
    if (node.type === "file") {
      result.push({ name: node.name, path: node.path });
    } else if (node.children) {
      result.push(...flattenFiles(node.children));
    }
  });
  return result;
}

export function FileTreePanel({
  nodes,
  activePath,
  onSelect,
  onDownloadFile,
  hideHeader,
  query = "",
}: FileTreePanelProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const files = useMemo(() => flattenFiles(nodes), [nodes]);
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);
  const matches = useMemo(() => {
    if (!normalizedQuery) return [];
    return files.filter((file) => file.path.toLowerCase().includes(normalizedQuery));
  }, [files, normalizedQuery]);

  const handleFileContextMenu = useCallback(
    (file: FlatFile, event: MouseEvent<HTMLButtonElement>) => {
      if (!onDownloadFile) return;

      event.preventDefault();
      setContextMenu({
        name: file.name,
        path: file.path,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [onDownloadFile]
  );

  const handleDownloadFromContextMenu = useCallback(() => {
    if (!contextMenu || !onDownloadFile) return;

    onDownloadFile(contextMenu.path);
    setContextMenu(null);
  }, [contextMenu, onDownloadFile]);

  return (
    <div className="flex h-full flex-col text-card-foreground">
      {!hideHeader && (
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Files
          </span>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="New file">
            <Plus size={16} weight="bold" />
          </Button>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-y-auto px-2.5 pb-4 scrollbar-none">
        {nodes.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <File size={24} weight="bold" className="text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              Empty workspace
            </p>
          </div>
        ) : normalizedQuery && matches.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <File size={24} weight="bold" className="text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">No files found</p>
          </div>
        ) : normalizedQuery ? (
          <div className="space-y-0.5">
            {matches.map((match) => (
                <button
                  key={match.path}
                  type="button"
                  onClick={() => onSelect(match.path)}
                  onContextMenu={(event) => handleFileContextMenu(match, event)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]",
                    "transition-colors hover:bg-foreground/5",
                    activePath === match.path
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/80"
                  )}
                >
                  <File
                    size={16}
                    weight="bold"
                    className={cn(
                      "shrink-0",
                      activePath === match.path ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  <span className="truncate font-medium">{match.name}</span>
                </button>
            ))}
          </div>
        ) : (
          <FileTree
            nodes={nodes}
            activePath={activePath}
            onSelect={onSelect}
            onFileContextMenu={handleFileContextMenu}
          />
        )}
      </div>
      {contextMenu ? (
        <FileTreeContextMenu
          fileName={contextMenu.name}
          onDownload={handleDownloadFromContextMenu}
          onOpenChange={(open) => {
            if (!open) {
              setContextMenu(null);
            }
          }}
          open
          x={contextMenu.x}
          y={contextMenu.y}
        />
      ) : null}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { File, MagnifyingGlass, Plus } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceFileNode } from "@/lib/opencode/types";

import { FileTree } from "./file-tree";

type FileTreePanelProps = {
  nodes: WorkspaceFileNode[];
  activePath?: string | null;
  onSelect: (path: string) => void;
};

type FlatFile = { name: string; path: string };

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

export function FileTreePanel({ nodes, activePath, onSelect }: FileTreePanelProps) {
  const [query, setQuery] = useState("");

  const files = useMemo(() => flattenFiles(nodes), [nodes]);
  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const normalized = query.trim().toLowerCase();
    return files.filter((file) => file.path.toLowerCase().includes(normalized));
  }, [files, query]);

  return (
    <div className="flex h-full flex-col bg-card/50">
      <div className="flex h-12 items-center justify-between gap-2 border-b border-border/60 px-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Archivos
        </span>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Nuevo archivo">
          <Plus size={16} weight="bold" />
        </Button>
      </div>

      <div className="px-3 py-3">
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/50 px-2.5 py-2">
          <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar..."
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <File size={24} weight="bold" className="text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              Workspace vacío
            </p>
          </div>
        ) : query.trim() ? (
          <div className="space-y-0.5">
            {matches.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Sin resultados
              </p>
            ) : (
              matches.map((match) => (
                <button
                  key={match.path}
                  type="button"
                  onClick={() => onSelect(match.path)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px]",
                    "transition-colors hover:bg-muted/60",
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
              ))
            )}
          </div>
        ) : (
          <FileTree nodes={nodes} activePath={activePath} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}

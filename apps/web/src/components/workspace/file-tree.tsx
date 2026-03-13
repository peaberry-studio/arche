"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { CaretRight, File, Folder, FolderOpen } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import type { WorkspaceFileNode } from "@/lib/opencode/types";

type FileTreeProps = {
  nodes: WorkspaceFileNode[];
  activePath?: string | null;
  onSelect: (path: string) => void;
  onFileContextMenu?: (
    file: Pick<WorkspaceFileNode, "name" | "path">,
    event: MouseEvent<HTMLButtonElement>
  ) => void;
};

type TreeState = Record<string, boolean>;

export function FileTree({ nodes, activePath, onSelect, onFileContextMenu }: FileTreeProps) {
  const initialExpanded = useMemo<TreeState>(() => {
    const state: TreeState = {};
    nodes.forEach((node) => {
      if (node.type === "directory") state[node.path] = true;
    });
    return state;
  }, [nodes]);

  const [expanded, setExpanded] = useState<TreeState>(initialExpanded);

  const toggle = (path: string) => {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const renderNode = (node: WorkspaceFileNode, depth: number) => {
    const isFolder = node.type === "directory";
    const isOpen = expanded[node.path];
    const isActive = activePath === node.path && !isFolder;
    const paddingLeft = 4 + depth * 12;

    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={() => (isFolder ? toggle(node.path) : onSelect(node.path))}
          onContextMenu={(event) => {
            if (isFolder) return;
            onFileContextMenu?.({ name: node.name, path: node.path }, event);
          }}
          className={cn(
            "group flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[13px]",
            "transition-colors hover:bg-muted/60",
            isActive
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
          style={{ paddingLeft }}
        >
          {isFolder ? (
            <>
              <CaretRight
                size={12}
                weight="bold"
                className={cn(
                  "shrink-0 text-muted-foreground transition-transform",
                  isOpen && "rotate-90"
                )}
              />
              {isOpen ? (
                <FolderOpen size={16} weight="bold" className="shrink-0 text-muted-foreground" />
              ) : (
                <Folder size={16} weight="bold" className="shrink-0 text-muted-foreground" />
              )}
            </>
          ) : (
            <>
              <span className="w-3 shrink-0" />
              <File
                size={16}
                weight="bold"
                className={cn(
                  "shrink-0",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              />
            </>
          )}
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {isFolder && isOpen && node.children ? (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        ) : null}
      </div>
    );
  };

  return <div>{nodes.map((node) => renderNode(node, 0))}</div>;
}

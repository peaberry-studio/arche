"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
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

function stripTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function getAncestorPaths(filePath: string): string[] {
  const segments = stripTrailingSlash(filePath).split("/");
  const ancestors: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i).join("/"));
  }
  return ancestors;
}

export function FileTree({ nodes, activePath, onSelect, onFileContextMenu }: FileTreeProps) {
  const initialExpanded = useMemo<TreeState>(() => {
    const state: TreeState = {};
    nodes.forEach((node) => {
      if (node.type === "directory") state[stripTrailingSlash(node.path)] = true;
    });
    return state;
  }, [nodes]);

  const [userToggles, setUserToggles] = useState<TreeState>(() => {
    if (!activePath) return {};
    const state: TreeState = {};
    for (const ancestor of getAncestorPaths(activePath)) {
      state[ancestor] = true;
    }
    return state;
  });

  const [prevActivePath, setPrevActivePath] = useState<string | null>(activePath ?? null);
  if (activePath !== prevActivePath) {
    setPrevActivePath(activePath ?? null);
    if (activePath) {
      const ancestors = getAncestorPaths(activePath);
      setUserToggles((prev) => {
        const next = { ...prev };
        for (const ancestor of ancestors) {
          next[ancestor] = true;
        }
        return next;
      });
    }
  }

  const expanded = useMemo<TreeState>(() => {
    return { ...initialExpanded, ...userToggles };
  }, [initialExpanded, userToggles]);

  const toggle = (path: string) => {
    const key = stripTrailingSlash(path);
    setUserToggles((prev) => ({ ...prev, [key]: !expanded[key] }));
  };

  const renderNode = (node: WorkspaceFileNode, depth: number) => {
    const isFolder = node.type === "directory";
    const nodeKey = isFolder ? stripTrailingSlash(node.path) : node.path;
    const isOpen = expanded[nodeKey];
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

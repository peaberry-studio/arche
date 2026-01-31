"use client";

import { Eye, File, GitDiff } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import type { WorkspaceDiff, WorkspaceFile } from "@/types/workspace";

import { MarkdownPreview } from "./markdown-preview";
import { ReviewPanel } from "./review-panel";

type InspectorPanelProps = {
  activeTab: "preview" | "review";
  onTabChange: (tab: "preview" | "review") => void;
  activeFile?: WorkspaceFile | null;
  diffs: WorkspaceDiff[];
  onOpenFile: (path: string) => void;
};

export function InspectorPanel({
  activeTab,
  onTabChange,
  activeFile,
  diffs,
  onOpenFile
}: InspectorPanelProps) {
  const pendingDiffs = diffs.length;

  return (
    <div className="flex h-full flex-col bg-card/50">
      <div className="flex h-12 items-center gap-1 border-b border-border/60 px-2">
        <button
          type="button"
          onClick={() => onTabChange("preview")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            activeTab === "preview"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <Eye size={14} weight={activeTab === "preview" ? "fill" : "bold"} />
          Preview
        </button>
        <button
          type="button"
          onClick={() => onTabChange("review")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            activeTab === "review"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <GitDiff size={14} weight={activeTab === "review" ? "fill" : "bold"} />
          Review
          {pendingDiffs > 0 ? (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/20 px-1 text-[10px] font-semibold text-primary">
              {pendingDiffs}
            </span>
          ) : null}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "preview" ? (
          activeFile ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border/60 bg-background/50 p-3">
                <div className="flex items-start gap-2">
                  <File size={16} weight="fill" className="mt-0.5 shrink-0 text-primary/70" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {activeFile.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {activeFile.path}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground/70">
                  <span>{activeFile.updatedAt}</span>
                  <span className="text-border">·</span>
                  <span>{activeFile.size}</span>
                </div>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/50 p-4">
                <MarkdownPreview content={activeFile.content} />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <File size={28} className="text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">
                Selecciona un archivo
              </p>
            </div>
          )
        ) : (
          <ReviewPanel diffs={diffs} onOpenFile={onOpenFile} />
        )}
      </div>
    </div>
  );
}

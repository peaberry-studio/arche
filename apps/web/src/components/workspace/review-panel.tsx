"use client";

import { useMemo } from "react";
import { Check, File, GitDiff, Minus, Plus } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceDiff } from "@/hooks/use-workspace";

type ReviewPanelProps = {
  diffs: WorkspaceDiff[];
  onOpenFile: (path: string) => void;
};

export function ReviewPanel({ diffs, onOpenFile }: ReviewPanelProps) {
  const totals = useMemo(() => {
    return diffs.reduce(
      (acc, diff) => {
        acc.additions += diff.additions;
        acc.deletions += diff.deletions;
        return acc;
      },
      { additions: 0, deletions: 0 }
    );
  }, [diffs]);

  if (diffs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <GitDiff size={28} className="text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">
          Sin cambios pendientes
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-2">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            {diffs.length} archivo{diffs.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-0.5 text-emerald-600">
            <Plus size={10} weight="bold" />
            {totals.additions}
          </span>
          <span className="flex items-center gap-0.5 text-red-500">
            <Minus size={10} weight="bold" />
            {totals.deletions}
          </span>
        </div>
        <Button size="sm" className="h-7 gap-1.5 px-2.5 text-xs" disabled>
          <Check size={12} weight="bold" />
          Aprobar
        </Button>
      </div>

      <div className="space-y-2">
        {diffs.map((diff) => (
          <div key={diff.path} className="rounded-lg border border-border/60 bg-background/50 overflow-hidden">
            <button
              type="button"
              onClick={() => onOpenFile(diff.path)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30"
            >
              <File
                size={14}
                weight="bold"
                className={cn(
                  diff.status === "added"
                    ? "text-emerald-500"
                    : diff.status === "deleted"
                      ? "text-red-500"
                      : "text-amber-500"
                )}
              />
              <span className="flex-1 truncate text-xs font-medium text-foreground">
                {diff.path}
              </span>
              <span className="flex items-center gap-1.5 text-[10px]">
                <span className="text-emerald-600">+{diff.additions}</span>
                <span className="text-red-500">-{diff.deletions}</span>
              </span>
            </button>
            <div className="border-t border-border/40 bg-muted/20">
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap p-2.5 text-[11px] leading-relaxed text-muted-foreground font-mono">
                {diff.diff}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

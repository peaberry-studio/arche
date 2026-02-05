"use client";

import { useCallback, useMemo, useState } from "react";
import { CaretDown, CaretRight, File, GitDiff, Minus, Plus } from "@phosphor-icons/react";

import { ConflictResolverDialog } from "./conflict-resolver-dialog";
import { PublishKbButton } from "./publish-kb-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DiffViewer } from "@/components/ui/diff-viewer";
import { cn } from "@/lib/utils";
import type { WorkspaceDiff } from "@/hooks/use-workspace";

type ReviewPanelProps = {
  slug: string;
  diffs: WorkspaceDiff[];
  isLoading?: boolean;
  error?: string;
  onOpenFile: (path: string) => void;
  onPublish?: () => void;
  onResolveConflict?: (path: string, content: string) => void;
};

const DIFF_PREVIEW_LINES = 120;

export function ReviewPanel({
  slug,
  diffs,
  isLoading,
  error,
  onOpenFile,
  onPublish,
  onResolveConflict,
}: ReviewPanelProps) {
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const [conflictPath, setConflictPath] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

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

  const conflictCount = useMemo(() => diffs.filter((diff) => diff.conflicted).length, [diffs]);
  const hasConflicts = conflictCount > 0;

  const toggleDiff = useCallback((path: string) => {
    setExpandedDiffs((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const openConflictResolver = useCallback((path: string) => {
    setConflictPath(path);
    setConflictOpen(true);
  }, []);

  const handleConflictOpenChange = useCallback((open: boolean) => {
    setConflictOpen(open);
    if (!open) {
      setConflictPath(null);
    }
  }, []);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <GitDiff size={28} className="text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">
          Unable to load changes
        </p>
        <p className="max-w-[320px] text-[11px] leading-relaxed text-muted-foreground/80">
          {error}
        </p>
      </div>
    );
  }

  if (diffs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <GitDiff size={32} className="text-muted-foreground/30" />
        <p className="max-w-[240px] text-sm text-muted-foreground">
          {isLoading ? 'Loading changes…' : 'No pending changes'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/50 px-3 py-2">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            {diffs.length} file{diffs.length !== 1 ? "s" : ""}
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
        <PublishKbButton
          slug={slug}
          onComplete={onPublish}
          disabled={hasConflicts}
          disabledReason={hasConflicts ? "Resolve conflicts before publishing" : undefined}
        />
      </div>

      {hasConflicts ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Detected {conflictCount} conflict{conflictCount !== 1 ? "s" : ""}. Resolve the files before publishing.
        </div>
      ) : null}

      <div className="space-y-2">
        {diffs.map((diff) => {
          const hasDiff = diff.diff.trim().length > 0;
          const diffLineCount = hasDiff ? diff.diff.split("\n").length : 0;
          const isLong = diffLineCount > DIFF_PREVIEW_LINES;
          const isExpanded = Boolean(expandedDiffs[diff.path]);
          const isCollapsed = isLong && !isExpanded;

          return (
            <div key={diff.path} className="overflow-hidden rounded-lg border border-border/40 bg-background/50">
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => onOpenFile(diff.path)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/30"
                >
                  <File
                    size={14}
                    weight="bold"
                    className={cn(
                      diff.conflicted
                        ? "text-amber-500"
                        : diff.status === "added"
                          ? "text-emerald-500"
                          : diff.status === "deleted"
                            ? "text-red-500"
                            : "text-amber-500"
                    )}
                  />
                  <span className="flex-1 truncate text-xs font-medium text-foreground" title={diff.path}>
                    {diff.path}
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px]">
                    {diff.conflicted ? (
                      <Badge variant="warning" className="px-2 py-0 text-[10px]">
                        Conflict
                      </Badge>
                    ) : null}
                    <span className="text-emerald-600">+{diff.additions}</span>
                    <span className="text-red-500">-{diff.deletions}</span>
                  </span>
                </button>
                {diff.conflicted ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={(event) => {
                      event.stopPropagation();
                      openConflictResolver(diff.path);
                    }}
                  >
                    Resolve
                  </Button>
                ) : null}
                {isLong ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => toggleDiff(diff.path)}
                  >
                    {isExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                    {isExpanded ? "Collapse" : "View diff"}
                  </Button>
                ) : null}
              </div>
              <div
                className={cn(
                  "border-t border-border/40 bg-muted/10",
                  isCollapsed ? "max-h-56 overflow-y-auto" : "max-h-none"
                )}
              >
                <DiffViewer
                  diff={diff.diff}
                  collapsed={isCollapsed}
                  maxLinesCollapsed={DIFF_PREVIEW_LINES}
                  onExpand={isCollapsed ? () => toggleDiff(diff.path) : undefined}
                />
              </div>
            </div>
          );
        })}
      </div>
      <ConflictResolverDialog
        slug={slug}
        path={conflictPath}
        open={conflictOpen}
        onOpenChange={handleConflictOpenChange}
        onResolved={(path, content) => {
          onResolveConflict?.(path, content);
        }}
      />
    </div>
  );
}

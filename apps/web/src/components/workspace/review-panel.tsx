"use client";

import { useCallback, useMemo, useState } from "react";
import { CaretDown, CaretRight, GitDiff, Trash } from "@phosphor-icons/react";

import { resolveWorkspaceConflictAction } from "@/actions/workspace-agent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DiffViewer } from "@/components/ui/diff-viewer";
import { KnowledgeReviewList } from "@/components/workspace/knowledge-review-list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkspaceDiff } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";

type QuickConflictStrategy = "ours" | "theirs";
export type ReviewTab = "proposals" | "changes";

type ReviewPanelProps = {
  slug: string;
  diffs: WorkspaceDiff[];
  activeTab: ReviewTab;
  isLoading?: boolean;
  error?: string;
  onOpenFile: (path: string) => void;
  internalLinkPaths?: string[];
  onProposalCountChange?: (count: number) => void;
  onDiscardFileChanges?: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onResolveConflict?: (path: string) => void | Promise<void>;
  onKnowledgeReviewApplied?: () => void | Promise<void>;
  knowledgeReviewRefreshKey?: number;
};

const DIFF_PREVIEW_LINES = 120;

export function ReviewPanel({
  slug,
  diffs,
  activeTab,
  isLoading,
  error,
  onOpenFile,
  internalLinkPaths,
  onProposalCountChange,
  onDiscardFileChanges,
  onKnowledgeReviewApplied,
  onResolveConflict,
  knowledgeReviewRefreshKey,
}: ReviewPanelProps) {
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const [resolvingConflict, setResolvingConflict] = useState<{
    path: string;
    strategy: QuickConflictStrategy;
  } | null>(null);
  const [conflictErrors, setConflictErrors] = useState<Record<string, string | undefined>>({});
  const [discardPath, setDiscardPath] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  const conflictCount = useMemo(() => diffs.filter((diff) => diff.conflicted).length, [diffs]);
  const hasConflicts = conflictCount > 0;

  const toggleDiff = useCallback((path: string) => {
    setExpandedDiffs((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const resolveConflict = useCallback(async (path: string, strategy: QuickConflictStrategy) => {
    setResolvingConflict({ path, strategy });
    setConflictErrors((prev) => ({ ...prev, [path]: undefined }));

    try {
      const result = await resolveWorkspaceConflictAction(slug, { path, strategy });
      if (!result.ok) {
        setConflictErrors((prev) => ({
          ...prev,
          [path]: result.error ?? "Unable to resolve conflict",
        }));
        return;
      }

      await onResolveConflict?.(path);
    } catch (err) {
      setConflictErrors((prev) => ({
        ...prev,
        [path]: err instanceof Error ? err.message : "Unable to resolve conflict",
      }));
    } finally {
      setResolvingConflict(null);
    }
  }, [onResolveConflict, slug]);

  const openDiscardConfirm = useCallback((path: string) => {
    setDiscardError(null);
    setDiscardPath(path);
    setDiscardOpen(true);
  }, []);

  const handleDiscardOpenChange = useCallback((open: boolean) => {
    setDiscardOpen(open);
    if (!open) {
      setDiscardPath(null);
      setDiscardError(null);
      setIsDiscarding(false);
    }
  }, []);

  return (
    <div className="h-full">
      <div
        className={cn("h-full", activeTab !== "proposals" && "hidden")}
        aria-hidden={activeTab !== "proposals"}
      >
        <KnowledgeReviewList
          slug={slug}
          refreshKey={knowledgeReviewRefreshKey}
          onApplied={onKnowledgeReviewApplied}
          onOpenCountChange={onProposalCountChange}
          onOpenFile={onOpenFile}
          internalLinkPaths={internalLinkPaths}
        />
      </div>
      <div
        className={cn("h-full", activeTab !== "changes" && "hidden")}
        aria-hidden={activeTab !== "changes"}
      >
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <GitDiff size={28} className="text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">Unable to load changes</p>
            <p className="max-w-[320px] text-[11px] leading-relaxed text-muted-foreground/80">{error}</p>
          </div>
        ) : diffs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <GitDiff size={28} className="text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">{isLoading ? 'Loading changes…' : 'No pending changes to publish'}</p>
            {isLoading ? null : (
              <p className="max-w-[320px] text-[11px] leading-relaxed text-muted-foreground/70">
                Applied proposals and your Knowledge Base edits show up here. Chat agents cannot write the Knowledge Base.
              </p>
            )}
          </div>
        ) : (
          <>
            {hasConflicts ? (
              <div className="rounded-md border-[0.5px] border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                Detected {conflictCount} conflict{conflictCount !== 1 ? "s" : ""}. Keep one version, or open the
                file to edit conflict markers manually.
              </div>
            ) : null}

            <div className="space-y-4">
              {diffs.map((diff) => {
                const hasDiff = diff.diff.trim().length > 0;
                const diffLineCount = hasDiff ? diff.diff.split("\n").length : 0;
                const isLong = diffLineCount > DIFF_PREVIEW_LINES;
                const isExpanded = Boolean(expandedDiffs[diff.path]);
                const isCollapsed = isLong && !isExpanded;
                const conflictError = conflictErrors[diff.path];
                const resolvingStrategy = resolvingConflict?.path === diff.path
                  ? resolvingConflict.strategy
                  : null;
                return (
                  <div key={diff.path} className="overflow-hidden rounded-md border-[0.5px] border-border/20 bg-foreground/[0.015]">
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenFile(diff.path)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/30"
                      >
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
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => void resolveConflict(diff.path, "ours")}
                            disabled={Boolean(resolvingConflict)}
                          >
                            {resolvingStrategy === "ours" ? "Keeping…" : "Keep local"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => void resolveConflict(diff.path, "theirs")}
                            disabled={Boolean(resolvingConflict)}
                          >
                            {resolvingStrategy === "theirs" ? "Keeping…" : "Keep remote"}
                          </Button>
                        </div>
                      ) : null}
                      {onDiscardFileChanges ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 text-muted-foreground/40 hover:text-muted-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            openDiscardConfirm(diff.path);
                          }}
                          aria-label="Discard changes"
                          title="Discard changes"
                        >
                          <Trash size={13} weight="regular" />
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
                    {conflictError ? (
                      <div className="border-t border-border/20 px-3 py-2 text-[11px] text-destructive">
                        {conflictError}
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        "border-t border-border/20 bg-foreground/[0.015]",
                        isCollapsed ? "max-h-56 overflow-y-auto scrollbar-custom" : "max-h-none"
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
          </>
        )}
      </div>

      <Dialog open={discardOpen} onOpenChange={handleDiscardOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
            <DialogDescription>
              This will revert the file to the last committed state in your workspace.
            </DialogDescription>
          </DialogHeader>
          {discardPath ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] text-foreground/80">
              {discardPath}
            </div>
          ) : null}
          {discardError ? (
            <p className="text-xs text-destructive">{discardError}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDiscardOpenChange(false)}
              disabled={isDiscarding}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!discardPath || isDiscarding || !onDiscardFileChanges}
              onClick={async () => {
                if (!discardPath || !onDiscardFileChanges) return;
                setIsDiscarding(true);
                setDiscardError(null);
                const result = await onDiscardFileChanges(discardPath);
                if (result.ok) {
                  handleDiscardOpenChange(false);
                  return;
                }
                setIsDiscarding(false);
                setDiscardError(result.error);
              }}
            >
              {isDiscarding ? "Discarding…" : "Discard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

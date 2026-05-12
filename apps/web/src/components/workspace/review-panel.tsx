"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowsClockwise, CaretDown, CaretRight, GitDiff, Trash, Warning } from "@phosphor-icons/react";

import { ConflictResolverDialog } from "./conflict-resolver-dialog";
import { GitHubConflictSection } from "./github-conflict-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DiffViewer } from "@/components/ui/diff-viewer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SyncKbResult } from "@/app/api/instances/[slug]/sync-kb/route";
import type { WorkspaceDiff } from "@/hooks/use-workspace";

type ReviewPanelProps = {
  slug: string;
  diffs: WorkspaceDiff[];
  isLoading?: boolean;
  error?: string;
  onOpenFile: (path: string) => void;
  onDiscardFileChanges?: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onResolveConflict?: (path: string, content: string) => void;
  githubSyncRequired?: boolean;
  githubSyncMessage?: string | null;
  githubMergePending?: boolean;
  githubConflictFiles?: string[];
  onPullGithubChanges?: () => Promise<SyncKbResult>;
  onGithubConflictResolved?: (path: string) => void;
  onGithubMergeFinalized?: () => void;
  onGithubMergeAborted?: () => void;
};

const DIFF_PREVIEW_LINES = 120;

export function ReviewPanel({
  slug,
  diffs,
  isLoading,
  error,
  onOpenFile,
  onDiscardFileChanges,
  onResolveConflict,
  githubSyncRequired,
  githubSyncMessage,
  githubMergePending,
  githubConflictFiles,
  onPullGithubChanges,
  onGithubConflictResolved,
  onGithubMergeFinalized,
  onGithubMergeAborted,
}: ReviewPanelProps) {
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const [conflictPath, setConflictPath] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [discardPath, setDiscardPath] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  const conflictCount = useMemo(() => diffs.filter((diff) => diff.conflicted).length, [diffs]);
  const hasConflicts = conflictCount > 0;
  const hasGithubConflicts = Boolean(githubMergePending || (githubConflictFiles && githubConflictFiles.length > 0));
  const hasGithubReviewAction = hasGithubConflicts || Boolean(githubSyncRequired);

  const toggleDiff = useCallback((path: string) => {
    setExpandedDiffs((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const openConflictResolver = useCallback((path: string) => {
    setConflictPath(path);
    setConflictOpen(true);
  }, []);

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

  const handleConflictOpenChange = useCallback((open: boolean) => {
    setConflictOpen(open);
    if (!open) {
      setConflictPath(null);
    }
  }, []);

  if (error && !hasGithubReviewAction) {
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

  if (diffs.length === 0 && !hasGithubReviewAction) {
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
    <div className="space-y-2">
      {githubSyncRequired && !hasGithubConflicts ? (
        <GitHubSyncRequiredSection
          message={githubSyncMessage}
          onPullGithubChanges={onPullGithubChanges}
        />
      ) : null}

      {hasGithubConflicts ? (
        <GitHubConflictSection
          slug={slug}
          mergePending={githubMergePending}
          conflictFiles={githubConflictFiles ?? []}
          onFileResolved={onGithubConflictResolved ?? (() => {})}
          onMergeFinalized={onGithubMergeFinalized ?? (() => {})}
          onMergeAborted={onGithubMergeAborted ?? (() => {})}
        />
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-500">
          Unable to load local workspace changes: {error}
        </div>
      ) : null}

      {hasConflicts ? (
        <div className="rounded-md border-[0.5px] border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          Detected {conflictCount} conflict{conflictCount !== 1 ? "s" : ""}. Resolve the files before publishing.
        </div>
      ) : null}

      <div className="space-y-3">
        {diffs.map((diff) => {
          const hasDiff = diff.diff.trim().length > 0;
          const diffLineCount = hasDiff ? diff.diff.split("\n").length : 0;
          const isLong = diffLineCount > DIFF_PREVIEW_LINES;
          const isExpanded = Boolean(expandedDiffs[diff.path]);
          const isCollapsed = isLong && !isExpanded;

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
      <ConflictResolverDialog
        slug={slug}
        path={conflictPath}
        open={conflictOpen}
        onOpenChange={handleConflictOpenChange}
        onResolved={(path, content) => {
          onResolveConflict?.(path, content);
        }}
      />

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

function GitHubSyncRequiredSection({
  message,
  onPullGithubChanges,
}: {
  message?: string | null;
  onPullGithubChanges?: () => Promise<SyncKbResult>;
}) {
  const [isPulling, setIsPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);

  const handlePull = useCallback(async () => {
    if (!onPullGithubChanges || isPulling) return;

    setIsPulling(true);
    setPullError(null);

    try {
      const result = await onPullGithubChanges();
      if (
        result.githubSyncStatus === "conflicts" ||
        ((result.githubSyncStatus === "pulled" || result.githubSyncStatus === "up_to_date") &&
          (result.status === "synced" || result.status === "conflicts"))
      ) {
        return;
      }
      setPullError(
        result.githubSyncStatus === "skipped"
          ? "GitHub remote is not ready. Check the GitHub KB remote settings."
          : result.githubSyncStatus === "pulled" || result.githubSyncStatus === "up_to_date"
            ? result.message ?? "Pull from GitHub completed, but updating the workspace failed."
          : result.message ?? "Pull from GitHub did not complete. The remote may still have newer changes.",
      );
    } catch (error) {
      setPullError(error instanceof Error ? error.message : "Pull from GitHub failed.");
    } finally {
      setIsPulling(false);
    }
  }, [isPulling, onPullGithubChanges]);

  return (
    <div className="space-y-2">
      <div className="rounded-md border-[0.5px] border-amber-500/25 bg-amber-500/5 p-2.5">
        <div className="flex items-center gap-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <Warning size={14} weight="bold" className="shrink-0" />
          <span>KB sync required</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {message || "GitHub has newer changes. Pull from GitHub before publishing again."}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          If local and GitHub changes conflict, the resolver will appear here.
        </p>
        <Button
          size="sm"
          className="mt-2 h-7 gap-1.5 px-3 text-[11px]"
          disabled={!onPullGithubChanges || isPulling}
          onClick={() => void handlePull()}
        >
          <ArrowsClockwise size={12} weight="bold" className={cn(isPulling && "animate-spin")} />
          {isPulling ? "Pulling…" : "Pull from GitHub"}
        </Button>
      </div>

      {pullError ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-500">
          {pullError}
        </div>
      ) : null}
    </div>
  );
}

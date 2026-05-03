"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLineLeft,
  ArrowLineRight,
  CaretLeft,
  CaretRight,
  File,
  GitDiff,
  X,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEditorDrafts, type SaveState } from "@/hooks/use-editor-drafts";
import type { WorkspaceDiff } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";

import { MarkdownPreview } from "./markdown-preview";
import { MarkdownEditor } from "./markdown-editor";
import { PublishKbButton } from "./publish-kb-button";
import { ReviewPanel } from "./review-panel";

type WorkspaceFile = {
  path: string;
  title: string;
  content: string;
  updatedAt: string;
  size: string;
  hash?: string;
  kind: 'markdown' | 'text';
};

type InspectorPanelProps = {
  slug: string;
  activeTab: "preview" | "review";
  panelMode?: "combined" | "files" | "review";
  workspaceAgentEnabled?: boolean;
  onTabChange: (tab: "preview" | "review") => void;
  rightCollapsed: boolean;
  onToggleRight: () => void;
  pendingDiffsForBadge?: number;
  onOpenReview?: () => void;
  openFiles: WorkspaceFile[];
  activeFilePath: string | null;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  diffs: WorkspaceDiff[];
  isLoadingDiffs?: boolean;
  diffsError?: string | null;
  onOpenFile: (path: string) => void;
  internalLinkPaths?: string[];
  onReloadFile?: (path: string) => Promise<void>;
  onSaveFile?: (
    path: string,
    content: string,
    expectedHash?: string
  ) => Promise<{ ok: true; hash?: string } | { ok: false; error: string }>;
  onDiscardFileChanges?: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onPublish?: () => void;
  onResolveConflict?: (path: string, content: string) => void;
  hideCollapseButton?: boolean;
};

// --- Minified (collapsed) panel ---

function MinifiedInspectorPanel({
  onToggleRight,
  onTabChange,
  panelMode = "combined",
  pendingDiffsForBadge = 0,
}: {
  onToggleRight: () => void;
  onTabChange: (tab: "preview" | "review") => void;
  panelMode?: "combined" | "files" | "review";
  pendingDiffsForBadge?: number;
}) {
  const badgeLabel = pendingDiffsForBadge > 99 ? "99+" : String(pendingDiffsForBadge);

  if (panelMode === "review") {
    return (
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleRight}
              aria-label="Expand review panel"
              className="group flex h-full w-full cursor-pointer flex-col items-center gap-3 py-4 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              {pendingDiffsForBadge > 0 ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-none text-primary-foreground">
                  {badgeLabel}
                </span>
              ) : (
                <span className="h-5" aria-hidden />
              )}
              <span
                className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground/80 transition-colors group-hover:text-foreground"
                style={{ writingMode: "vertical-rl" }}
              >
                Review
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            Expand review{pendingDiffsForBadge > 0 ? ` (${pendingDiffsForBadge})` : ""}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full w-full flex-col items-center py-2 text-card-foreground">
        {/* Toggle expand */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleRight}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Expand panel"
            >
              <ArrowLineLeft size={13} weight="bold" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Expand panel</TooltipContent>
        </Tooltip>

        <div className="my-2 h-px w-6 bg-border/40" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => { onToggleRight(); onTabChange("preview"); }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Files"
            >
              <File size={13} weight="bold" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Files</TooltipContent>
        </Tooltip>

        {panelMode === "combined" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => { onToggleRight(); onTabChange("review"); }}
                className="relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                aria-label="Review"
              >
                <GitDiff size={13} weight="bold" />
                {pendingDiffsForBadge > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {badgeLabel}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Review{pendingDiffsForBadge > 0 ? ` (${pendingDiffsForBadge})` : ""}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

// --- Expanded panel ---

export function InspectorPanel({
  slug,
  activeTab,
  panelMode = "combined",
  workspaceAgentEnabled = true,
  onTabChange,
  rightCollapsed,
  onToggleRight,
  pendingDiffsForBadge = 0,
  openFiles,
  activeFilePath,
  onSelectFile,
  onCloseFile,
  diffs,
  isLoadingDiffs,
  diffsError,
  onOpenFile,
  internalLinkPaths,
  onReloadFile,
  onSaveFile,
  onDiscardFileChanges,
  onPublish,
  onResolveConflict,
  hideCollapseButton = false,
}: InspectorPanelProps) {
  // Minified state
  if (rightCollapsed) {
    return (
      <MinifiedInspectorPanel
        onToggleRight={onToggleRight}
        onTabChange={onTabChange}
        panelMode={panelMode}
        pendingDiffsForBadge={pendingDiffsForBadge}
      />
    );
  }

  // Expanded state
  return (
    <ExpandedInspectorPanel
      slug={slug}
      activeTab={activeTab}
      panelMode={panelMode}
      workspaceAgentEnabled={workspaceAgentEnabled}
      onTabChange={onTabChange}
      onToggleRight={onToggleRight}
      pendingDiffsForBadge={pendingDiffsForBadge}
      openFiles={openFiles}
      activeFilePath={activeFilePath}
      onSelectFile={onSelectFile}
      onCloseFile={onCloseFile}
      diffs={diffs}
      isLoadingDiffs={isLoadingDiffs}
      diffsError={diffsError}
      onOpenFile={onOpenFile}
      internalLinkPaths={internalLinkPaths}
      onReloadFile={onReloadFile}
      onSaveFile={onSaveFile}
      onDiscardFileChanges={onDiscardFileChanges}
      onPublish={onPublish}
      onResolveConflict={onResolveConflict}
      hideCollapseButton={hideCollapseButton}
    />
  );
}

function ExpandedInspectorPanel({
  slug,
  activeTab,
  panelMode = "combined",
  workspaceAgentEnabled = true,
  onTabChange,
  onToggleRight,
  openFiles,
  activeFilePath,
  onSelectFile,
  onCloseFile,
  diffs,
  isLoadingDiffs,
  diffsError,
  onOpenFile,
  internalLinkPaths = [],
  onReloadFile,
  onSaveFile,
  onDiscardFileChanges,
  onPublish,
  onResolveConflict,
  hideCollapseButton = false,
}: Omit<InspectorPanelProps, "rightCollapsed" | "onOpenReview">) {
  const pendingDiffs = diffs.length;
  const effectiveActiveTab = panelMode === "files" ? "preview" : panelMode === "review" ? "review" : activeTab;
  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null;
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const { clearDraft, getDraft, getSaveError, getSaveState, handleChange } = useEditorDrafts({
    onSave: onSaveFile,
  });
  const prevContentRef = useRef<Record<string, string>>({});

  const handleReload = useCallback(
    async (path: string) => {
      if (!onReloadFile) return;
      await onReloadFile(path);
      clearDraft(path);
    },
    [clearDraft, onReloadFile]
  );

  useEffect(() => {
    const openFilePaths = new Set(openFiles.map((file) => file.path));

    for (const file of openFiles) {
      const prev = prevContentRef.current[file.path];
      if (prev !== undefined && prev !== file.content) {
        const state = getSaveState(file.path);
        if (state === "idle" || state === "saved") {
          clearDraft(file.path);
        }
      }
      prevContentRef.current[file.path] = file.content;
    }

    Object.keys(prevContentRef.current).forEach((path) => {
      if (!openFilePaths.has(path)) {
        delete prevContentRef.current[path];
      }
    });
  }, [clearDraft, getSaveState, openFiles]);

  const activeDraft = activeFile
    ? getDraft(activeFile.path, activeFile.content)
    : null;
  const canEditMarkdown = workspaceAgentEnabled && Boolean(onSaveFile);
  const activeSaveState: SaveState = activeFile
    ? getSaveState(activeFile.path)
    : "idle";
  const activeSaveError = activeFile
    ? getSaveError(activeFile.path)
    : null;

  const updateScrollState = () => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  };

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState);
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [openFiles]);

  const scrollTabs = (direction: "left" | "right") => {
    const el = tabsRef.current;
    if (!el) return;
    const scrollAmount = 150;
    el.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth"
    });
  };

  const isReviewActive = effectiveActiveTab === "review";

  const showHeader = panelMode !== "files";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col pr-0 text-card-foreground">
      {/* Main container — header now lives inside */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-none">

      {/* In-container header (combined: tabs; review: collapse + label + publish) */}
      {showHeader ? (
        <div className="flex shrink-0 items-center gap-2 pl-2 pr-3 py-2">
          {/* Collapse panel — placed on the side opposite to where the panel docks */}
          {!hideCollapseButton && (
            <button
              type="button"
              onClick={onToggleRight}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Collapse panel"
              title="Collapse panel"
            >
              <ArrowLineRight size={13} weight="bold" />
            </button>
          )}

          {workspaceAgentEnabled && panelMode === "combined" ? (
            <div className="flex flex-1 justify-start">
              <div className="inline-flex h-8 items-center rounded-lg bg-foreground/[0.05] p-0.5 text-[11px]">
                {/* Inspect segment */}
                <button
                  type="button"
                  onClick={() => onTabChange("preview")}
                  className={cn(
                    "relative flex h-7 items-center gap-1.5 rounded-md px-2.5 font-medium transition-colors",
                    !isReviewActive
                      ? "bg-background text-foreground/85"
                      : "text-muted-foreground hover:text-foreground/80"
                  )}
                  aria-pressed={!isReviewActive}
                >
                  <File size={12} weight={!isReviewActive ? "fill" : "bold"} />
                  Inspect
                </button>

                {/* Review segment */}
                <button
                  type="button"
                  onClick={() => onTabChange("review")}
                  className={cn(
                    "relative flex h-7 items-center gap-1.5 rounded-md px-2.5 font-medium transition-colors",
                    isReviewActive
                      ? "bg-background text-foreground/85"
                      : "text-muted-foreground hover:text-foreground/80"
                  )}
                  aria-pressed={isReviewActive}
                >
                  <GitDiff size={12} weight={isReviewActive ? "fill" : "bold"} />
                  Review
                  {pendingDiffs > 0 ? (
                    <span
                      className={cn(
                        "flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
                        isReviewActive
                          ? "bg-foreground/10 text-foreground/85"
                          : "bg-primary text-primary-foreground"
                      )}
                    >
                      {pendingDiffs > 99 ? "99+" : pendingDiffs}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-8 min-w-0 flex-1 items-center">
              <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>{panelMode === "review" ? "Review" : "Inspect"}</span>
                {panelMode === "review" && pendingDiffs > 0 ? (
                  <span className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                    {pendingDiffs > 99 ? "99+" : pendingDiffs}
                  </span>
                ) : null}
              </p>
            </div>
          )}

          {/* Publish action — review mode only */}
          {panelMode === "review" && workspaceAgentEnabled ? (
            <PublishKbButton
              slug={slug}
              onComplete={onPublish}
              disabled={diffs.some((diff) => diff.conflicted)}
              disabledReason={
                diffs.some((diff) => diff.conflicted)
                  ? "Resolve conflicts before publishing"
                  : undefined
              }
            />
          ) : null}
        </div>
      ) : null}
      {/* File tabs row — only in Files mode with open files */}
      {effectiveActiveTab === "preview" && openFiles.length > 0 && (
        <div className="flex min-h-9 shrink-0 items-center border-b border-border/30 py-2">
          <div className="flex min-w-0 flex-1 items-center">
            {canScrollLeft && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                onClick={() => scrollTabs("left")}
                aria-label="Scroll left"
              >
                <CaretLeft size={12} weight="bold" />
              </Button>
            )}

            <div
              ref={tabsRef}
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-3 py-1 scrollbar-none"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {openFiles.map((file) => (
                <div
                  key={file.path}
                  className={cn(
                    "group flex shrink-0 items-center gap-1 rounded-lg pl-2.5 pr-1 py-1 text-xs transition-colors",
                    file.path === activeFilePath
                      ? "bg-primary/10 text-primary"
                      : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectFile(file.path)}
                    className="flex items-center gap-1.5"
                  >
                    <span className="max-w-[120px] truncate font-medium">{file.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseFile(file.path);
                    }}
                    className={cn(
                      "ml-0.5 rounded p-0.5 transition-colors",
                      "opacity-0 group-hover:opacity-100",
                      "hover:bg-foreground/10",
                      file.path === activeFilePath && "opacity-100"
                    )}
                    aria-label={`Close ${file.title}`}
                  >
                    <X size={12} weight="bold" />
                  </button>
                </div>
              ))}
            </div>

            {canScrollRight && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                onClick={() => scrollTabs("right")}
                aria-label="Scroll right"
              >
                <CaretRight size={12} weight="bold" />
              </Button>
            )}
          </div>

        </div>
      )}

      {/* Content area */}
      <div className="relative flex-1 min-h-0">
        <div
          className={cn("absolute inset-0", effectiveActiveTab !== "preview" && "hidden")}
          aria-hidden={effectiveActiveTab !== "preview"}
        >
          {openFiles.length > 0 ? (
            <div className="flex h-full min-h-0 flex-col">
              {/* File content */}
              {activeFile ? (
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none">
                  {activeFile.kind === "markdown" && activeDraft != null && canEditMarkdown ? (
                    <MarkdownEditor
                      key={activeFile.path}
                      value={activeDraft}
                      onChange={(next) =>
                        handleChange(activeFile.path, next, activeFile.content, activeFile.hash)
                      }
                      saveState={activeSaveState}
                      saveError={activeSaveError}
                      modifiedAt={activeFile.updatedAt}
                      internalLinkPaths={internalLinkPaths}
                      onOpenInternalLink={onOpenFile}
                      onReload={onReloadFile ? () => void handleReload(activeFile.path) : undefined}
                    />
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3 px-5 py-3">
                        <p className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                          {activeFile.path}
                        </p>
                        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>{activeFile.updatedAt}</span>
                        </div>
                      </div>
                      <div className="px-6 py-6">
                        <MarkdownPreview content={activeFile.content} />
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {workspaceAgentEnabled && (
          <div
            className={cn(
              "absolute inset-0 overflow-y-auto scrollbar-custom px-3 pb-3 pt-1",
              effectiveActiveTab !== "review" && "hidden"
            )}
          >
            <ReviewPanel
              slug={slug}
              diffs={diffs}
              isLoading={Boolean(isLoadingDiffs)}
              error={diffsError ?? undefined}
              onOpenFile={onOpenFile}
              onDiscardFileChanges={onDiscardFileChanges}
              onResolveConflict={onResolveConflict}
            />
          </div>
        )}
      </div>
      </div>
      </div>
    </TooltipProvider>
  );
}

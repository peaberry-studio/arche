"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLineLeft,
  ArrowLineRight,
  CaretLeft,
  CaretRight,
  File,
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
import { ReviewPanel, type ReviewTab } from "./review-panel";
import { SegmentedControl, type SegmentedControlOption } from "./segmented-control";

type WorkspaceFile = {
  path: string;
  title: string;
  content: string;
  updatedAt: string;
  size: string;
  hash?: string;
  kind: 'markdown' | 'text';
};

type ConflictMarkerTextEditorProps = {
  value: string;
  onChange: (next: string) => void;
  saveState: SaveState;
  saveError?: string | null;
  onReload?: () => void;
  modifiedAt?: string;
};

const KNOWLEDGE_REVIEW_TAB_OPTIONS: SegmentedControlOption<ReviewTab>[] = [
  { value: "proposals", label: "Proposals" },
  { value: "changes", label: "Pending publish" },
];

type InspectorPanelProps = {
  slug: string;
  panelMode?: "combined" | "files" | "knowledge";
  workspaceAgentEnabled?: boolean;
  onTabChange: (tab: "preview" | "review") => void;
  rightCollapsed: boolean;
  onToggleRight: () => void;
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
  onResolveConflict?: (path: string) => void | Promise<void>;
  onKnowledgeReviewApplied?: () => void | Promise<void>;
  onProposalCountChange?: (count: number) => void;
  knowledgeReviewRefreshKey?: number;
  hideCollapseButton?: boolean;
};

// --- Minified (collapsed) panel ---

function MinifiedInspectorPanel({
  onToggleRight,
  onTabChange,
}: {
  onToggleRight: () => void;
  onTabChange: (tab: "preview" | "review") => void;
}) {
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

      </div>
    </TooltipProvider>
  );
}

function hasGitConflictMarkers(content: string): boolean {
  return content.split(/\r?\n/).some((line) => (
    line.startsWith("<<<<<<<") || line.startsWith("=======") || line.startsWith(">>>>>>>")
  ));
}

function ConflictMarkerTextEditor({
  value,
  onChange,
  saveState,
  saveError,
  onReload,
  modifiedAt,
}: ConflictMarkerTextEditorProps) {
  const isEditing = saveState === "dirty" || saveState === "saving";
  const isError = saveState === "error";
  const statusLabel = isError ? "Error" : isEditing ? "Editing" : "Saved";
  const reloadRecommended = Boolean(saveState === "error" && saveError && saveError.includes("conflict"));

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/30 px-4 py-2">
        <p className="min-w-0 text-[11px] text-muted-foreground">
          Edit the conflict markers directly. Remove every{" "}
          <span className="font-mono">&lt;&lt;&lt;&lt;&lt;&lt;&lt;</span>,{" "}
          <span className="font-mono">=======</span>, and{" "}
          <span className="font-mono">&gt;&gt;&gt;&gt;&gt;&gt;&gt;</span> line to resolve.
        </p>
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          {onReload && reloadRecommended ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={onReload}
            >
              Reload
            </Button>
          ) : null}
          {modifiedAt ? <span className="shrink-0 text-muted-foreground">{modifiedAt}</span> : null}
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isError ? "bg-destructive" : isEditing ? "bg-amber-400" : "bg-emerald-500",
                isEditing && "animate-pulse"
              )}
            />
            <span>{statusLabel}</span>
          </div>
          {saveError ? (
            <span className="min-w-0 truncate text-destructive/90" title={saveError}>
              {saveError}
            </span>
          ) : null}
        </div>
      </div>
      <textarea
        aria-label="Edit conflict file"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "min-h-0 flex-1 resize-none bg-background px-6 py-4 font-mono text-[12px] leading-relaxed text-foreground",
          "outline-none scrollbar-custom"
        )}
        spellCheck={false}
      />
    </div>
  );
}

// --- Expanded panel ---

export function InspectorPanel({
  slug,
  panelMode = "combined",
  workspaceAgentEnabled = true,
  onTabChange,
  rightCollapsed,
  onToggleRight,
  openFiles,
  activeFilePath,
  onSelectFile,
  onCloseFile,
  diffs,
  isLoadingDiffs,
  diffsError,
  onOpenFile,
  onKnowledgeReviewApplied,
  onProposalCountChange,
  knowledgeReviewRefreshKey,
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
      />
    );
  }

  // Expanded state
  return (
    <ExpandedInspectorPanel
      slug={slug}
      panelMode={panelMode}
      workspaceAgentEnabled={workspaceAgentEnabled}
      onTabChange={onTabChange}
      onToggleRight={onToggleRight}
      openFiles={openFiles}
      activeFilePath={activeFilePath}
      onSelectFile={onSelectFile}
      onCloseFile={onCloseFile}
      diffs={diffs}
      isLoadingDiffs={isLoadingDiffs}
      diffsError={diffsError}
      onOpenFile={onOpenFile}
      onKnowledgeReviewApplied={onKnowledgeReviewApplied}
      onProposalCountChange={onProposalCountChange}
      knowledgeReviewRefreshKey={knowledgeReviewRefreshKey}
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
  onKnowledgeReviewApplied,
  onProposalCountChange,
  knowledgeReviewRefreshKey,
  internalLinkPaths = [],
  onReloadFile,
  onSaveFile,
  onDiscardFileChanges,
  onPublish,
  onResolveConflict,
  hideCollapseButton = false,
}: Omit<InspectorPanelProps, "rightCollapsed">) {
  const pendingDiffs = diffs.length;
  const effectiveActiveTab = panelMode === "files" || panelMode === "combined"
    ? "preview"
    : "review";
  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null;
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [reviewTab, setReviewTab] = useState<ReviewTab>("proposals");
  const [reviewProposalCount, setReviewProposalCount] = useState(0);
  // The review list already refetches after every action, so it is the source
  // of the open-proposal count for both the tab badge and the shell.
  const handleProposalCountChange = useCallback((count: number) => {
    setReviewProposalCount(count);
    onProposalCountChange?.(count);
  }, [onProposalCountChange]);
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
  const activeDiff = activeFile
    ? diffs.find((diff) => diff.path === activeFile.path)
    : undefined;
  const useConflictTextEditor = Boolean(
    activeFile?.kind === "markdown" &&
    activeDraft !== null &&
    canEditMarkdown &&
    (activeDiff?.conflicted || hasGitConflictMarkers(activeDraft))
  );

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

  const showHeader = panelMode !== "files";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col pr-0 text-card-foreground">
      {/* Main container — header now lives inside */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-none">

      {/* In-container header (combined: tabs; review: collapse + label + publish) */}
      {showHeader ? (
        <div className="flex shrink-0 items-center gap-2 px-4 py-3">
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
              <div className="inline-flex items-center gap-0.5 rounded-lg bg-foreground/[0.05] p-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => onTabChange("preview")}
                  className={cn(
                    "relative flex h-7 items-center gap-1.5 rounded-md px-3 font-medium transition-colors",
                    "bg-background text-foreground/85"
                  )}
                  aria-pressed
                >
                  <File size={12} weight="fill" />
                  Inspect
                </button>
              </div>
            </div>
          ) : panelMode === "knowledge" ? (
            <div className="flex h-8 min-w-0 flex-1 items-center">
              <SegmentedControl
                variant="outline"
                value={reviewTab}
                onValueChange={setReviewTab}
                options={KNOWLEDGE_REVIEW_TAB_OPTIONS.map((option) => ({
                  ...option,
                  badge: option.value === "proposals" ? reviewProposalCount : pendingDiffs,
                }))}
              />
            </div>
          ) : (
            <div className="flex h-8 min-w-0 flex-1 items-center">
              <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Inspect</span>
              </p>
            </div>
          )}

          {/* Publish action — knowledge mode only, shown when there is something to publish */}
          {panelMode === "knowledge" && workspaceAgentEnabled && diffs.length > 0 ? (
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
                    useConflictTextEditor ? (
                      <ConflictMarkerTextEditor
                        value={activeDraft}
                        onChange={(next) =>
                          handleChange(activeFile.path, next, activeFile.content, activeFile.hash)
                        }
                        saveState={activeSaveState}
                        saveError={activeSaveError}
                        modifiedAt={activeFile.updatedAt}
                        onReload={onReloadFile ? () => void handleReload(activeFile.path) : undefined}
                      />
                    ) : (
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
                    )
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

        {(workspaceAgentEnabled || panelMode === "knowledge") && (
          <div
            className={cn(
              "absolute inset-0 overflow-y-auto scrollbar-custom px-4 pb-8 pt-2",
              effectiveActiveTab !== "review" && "hidden"
            )}
          >
            <ReviewPanel
              slug={slug}
              diffs={diffs}
              activeTab={reviewTab}
              isLoading={Boolean(isLoadingDiffs)}
              error={diffsError ?? undefined}
              onOpenFile={onOpenFile}
              internalLinkPaths={internalLinkPaths}
              onProposalCountChange={handleProposalCountChange}
              onDiscardFileChanges={onDiscardFileChanges}
              onKnowledgeReviewApplied={onKnowledgeReviewApplied}
              knowledgeReviewRefreshKey={knowledgeReviewRefreshKey}
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

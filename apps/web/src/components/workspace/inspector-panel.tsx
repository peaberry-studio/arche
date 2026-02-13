"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, File, GitDiff, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { useEditorDrafts, type SaveState } from "@/hooks/use-editor-drafts";
import type { WorkspaceDiff } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";

import { MarkdownPreview } from "./markdown-preview";
import { MarkdownEditor } from "./markdown-editor";
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
  onTabChange: (tab: "preview" | "review") => void;
  openFiles: WorkspaceFile[];
  activeFilePath: string | null;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  diffs: WorkspaceDiff[];
  isLoadingDiffs?: boolean;
  diffsError?: string | null;
  onOpenFile: (path: string) => void;
  onReloadFile?: (path: string) => Promise<void>;
  onSaveFile?: (
    path: string,
    content: string,
    expectedHash?: string
  ) => Promise<{ ok: true; hash?: string } | { ok: false; error: string }>;
  onDiscardFileChanges?: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onPublish?: () => void;
  onResolveConflict?: (path: string, content: string) => void;
};

export function InspectorPanel({
  slug,
  activeTab,
  onTabChange,
  openFiles,
  activeFilePath,
  onSelectFile,
  onCloseFile,
  diffs,
  isLoadingDiffs,
  diffsError,
  onOpenFile,
  onReloadFile,
  onSaveFile,
  onDiscardFileChanges,
  onPublish,
  onResolveConflict
}: InspectorPanelProps) {
  const pendingDiffs = diffs.length;
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

  return (
    <div className="flex h-full flex-col text-card-foreground">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/10 pl-2 pr-2">
        <button
          type="button"
          onClick={() => onTabChange("preview")}
          className={cn(
            "flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors",
            activeTab === "preview"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          )}
        >
          <File size={14} weight={activeTab === "preview" ? "fill" : "bold"} />
          Working context
        </button>
        <button
          type="button"
          onClick={() => onTabChange("review")}
          className={cn(
            "flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors",
            activeTab === "review"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
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

      <div className="relative flex-1 min-h-0">
        <div
          className={cn("absolute inset-0", activeTab !== "preview" && "hidden")}
          aria-hidden={activeTab !== "preview"}
        >
          {openFiles.length > 0 ? (
            <div className="flex h-full min-h-0 flex-col">
                {/* File tabs */}
                <div className="flex items-center border-b border-white/10">
                  {canScrollLeft && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => scrollTabs("left")}
                      aria-label="Scroll izquierda"
                    >
                      <CaretLeft size={12} weight="bold" />
                    </Button>
                  )}

                  <div
                    ref={tabsRef}
                    className="flex flex-1 items-center gap-0.5 overflow-x-auto pl-3 pr-2 py-2 scrollbar-none"
                    style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                  >
                    {openFiles.map((file) => (
                      <div
                        key={file.path}
                        className={cn(
                          "group flex shrink-0 items-center gap-1 rounded-lg pl-2.5 pr-1 py-1 text-xs transition-colors",
                          file.path === activeFilePath
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
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
                      aria-label="Scroll derecha"
                    >
                      <CaretRight size={12} weight="bold" />
                    </Button>
                  )}
                </div>

                {/* File content */}
                {activeFile ? (
                  <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none">
                    {activeFile.kind === "markdown" && activeDraft != null ? (
                      <MarkdownEditor
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
                      <>
                        <div className="flex items-center justify-between gap-3 px-5 py-3">
                          <p className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                            {activeFile.path}
                          </p>
                          <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span>{activeFile.updatedAt}</span>
                          </div>
                        </div>
                        <div className="border-t border-white/10" />
                        <div className="px-6 py-6">
                          <MarkdownPreview content={activeFile.content} />
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
              <File size={32} className="text-muted-foreground/30" />
              <p className="max-w-[240px] text-sm text-muted-foreground">
                Select a file
              </p>
            </div>
          )}
        </div>

        <div
          className={cn(
            "absolute inset-0 overflow-y-auto scrollbar-none p-5",
            activeTab !== "review" && "hidden"
          )}
        >
          <ReviewPanel
            slug={slug}
            diffs={diffs}
            isLoading={Boolean(isLoadingDiffs)}
            error={diffsError ?? undefined}
            onOpenFile={onOpenFile}
            onDiscardFileChanges={onDiscardFileChanges}
            onPublish={onPublish}
            onResolveConflict={onResolveConflict}
          />
        </div>
      </div>
    </div>
  );
}

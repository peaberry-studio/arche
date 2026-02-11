"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaretLeft, CaretRight, Eye, File, GitDiff, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceDiff } from "@/hooks/use-workspace";

import { MarkdownPreview } from "./markdown-preview";
import { MarkdownEditor } from "./markdown-editor";
import { ReviewPanel } from "./review-panel";

type WorkspaceFile = {
  path: string;
  title: string;
  content: string;
  updatedAt: string;
  size: string;
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
    content: string
  ) => Promise<{ ok: true; hash?: string } | { ok: false; error: string }>;
  onDiscardFileChanges?: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onPublish?: () => void;
  onResolveConflict?: (path: string, content: string) => void;
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

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

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [lastSaved, setLastSaved] = useState<Record<string, string>>({});
  const [saveStateByPath, setSaveStateByPath] = useState<Record<string, SaveState>>({});
  const [saveErrorByPath, setSaveErrorByPath] = useState<Record<string, string | null>>({});
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  const activeDraft = useMemo(() => {
    if (!activeFile) return null;
    return drafts[activeFile.path] ?? activeFile.content;
  }, [activeFile, drafts]);

  const activeSaveState = useMemo(() => {
    if (!activeFile) return "idle" as const;
    return saveStateByPath[activeFile.path] ?? "idle";
  }, [activeFile, saveStateByPath]);

  const activeSaveError = useMemo(() => {
    if (!activeFile) return null;
    return saveErrorByPath[activeFile.path] ?? null;
  }, [activeFile, saveErrorByPath]);

  const scheduleAutosave = useCallback(
    (path: string, content: string, baseline: string) => {
      if (!onSaveFile) return;

      const timer = saveTimersRef.current[path];
      if (timer) clearTimeout(timer);

      saveTimersRef.current[path] = setTimeout(async () => {
        if (baseline === content) {
          return;
        }

        setSaveStateByPath((prev) => ({ ...prev, [path]: "saving" }));
        setSaveErrorByPath((prev) => ({ ...prev, [path]: null }));

        const result = await onSaveFile(path, content);
        if (result.ok) {
          setLastSaved((prev) => ({ ...prev, [path]: content }));
          setSaveStateByPath((prev) => ({ ...prev, [path]: "saved" }));
          return;
        }

        setSaveStateByPath((prev) => ({ ...prev, [path]: "error" }));
        setSaveErrorByPath((prev) => ({ ...prev, [path]: result.error }));
      }, 600);
    },
    [onSaveFile]
  );

  const handleDraftChange = useCallback(
    (path: string, next: string, baseline: string) => {
      setDrafts((prev) => ({ ...prev, [path]: next }));
      setSaveStateByPath((prev) => ({ ...prev, [path]: "dirty" }));
      setSaveErrorByPath((prev) => ({ ...prev, [path]: null }));
      scheduleAutosave(path, next, baseline);
    },
    [scheduleAutosave]
  );

  const handleReload = useCallback(
    async (path: string) => {
      if (!onReloadFile) return;
      await onReloadFile(path);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      setLastSaved((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      setSaveStateByPath((prev) => ({ ...prev, [path]: "idle" }));
      setSaveErrorByPath((prev) => ({ ...prev, [path]: null }));
    },
    [onReloadFile]
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
          <Eye size={14} weight={activeTab === "preview" ? "fill" : "bold"} />
          View
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

      <div className="flex-1 overflow-y-auto scrollbar-none">
        {activeTab === "preview" ? (
          openFiles.length > 0 ? (
            <div className="flex h-full flex-col">
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
                <div className="flex-1 overflow-y-auto scrollbar-none">
                  {activeFile.kind === "markdown" && activeDraft != null ? (
                    (() => {
                      const hasDraft = typeof drafts[activeFile.path] === "string";
                      const baseline = hasDraft
                        ? lastSaved[activeFile.path] ?? activeFile.content
                        : activeFile.content;
                      return (
                        <MarkdownEditor
                          value={activeDraft}
                          onChange={(next) => handleDraftChange(activeFile.path, next, baseline)}
                          saveState={activeSaveState}
                          saveError={activeSaveError}
                          modifiedAt={activeFile.updatedAt}
                          onReload={onReloadFile ? () => void handleReload(activeFile.path) : undefined}
                        />
                      );
                    })()
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
          )
        ) : (
          <div className="h-full p-5">
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
        )}
      </div>
    </div>
  );
}

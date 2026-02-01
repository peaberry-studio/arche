"use client";

import { useRef, useState, useEffect } from "react";
import { CaretLeft, CaretRight, Eye, File, GitDiff, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceDiff } from "@/hooks/use-workspace";

import { MarkdownPreview } from "./markdown-preview";
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
  activeTab: "preview" | "review";
  onTabChange: (tab: "preview" | "review") => void;
  openFiles: WorkspaceFile[];
  activeFilePath: string | null;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  diffs: WorkspaceDiff[];
  onOpenFile: (path: string) => void;
};

function getParentFolder(path: string): string | null {
  const parts = path.split("/");
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join("/");
}

export function InspectorPanel({
  activeTab,
  onTabChange,
  openFiles,
  activeFilePath,
  onSelectFile,
  onCloseFile,
  diffs,
  onOpenFile
}: InspectorPanelProps) {
  const pendingDiffs = diffs.length;
  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null;
  const parentFolder = activeFile ? getParentFolder(activeFile.path) : null;

  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
    <div className="flex h-full flex-col bg-card/50">
      <div className="flex h-12 items-center gap-1 border-b border-border/60 px-3">
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

      <div className="flex-1 overflow-y-auto">
        {activeTab === "preview" ? (
          openFiles.length > 0 ? (
            <div className="flex h-full flex-col">
              {/* File tabs */}
              <div className="flex items-center border-b border-border/60">
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
                  className="flex flex-1 items-center gap-0.5 overflow-x-auto px-2 py-1.5 scrollbar-none"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {openFiles.map((file) => (
                    <div
                      key={file.path}
                      className={cn(
                        "group flex shrink-0 items-center gap-1 rounded-md pl-2.5 pr-1 py-1 text-xs transition-colors",
                        file.path === activeFilePath
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
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
                        aria-label={`Cerrar ${file.title}`}
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
                <>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <p className="min-w-0 truncate text-sm font-medium text-foreground">
                      {activeFile.title}
                    </p>
                    <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      {parentFolder ? (
                        <>
                          <span className="max-w-[100px] truncate">{parentFolder}</span>
                          <span className="text-border">·</span>
                        </>
                      ) : null}
                      <span>{activeFile.updatedAt}</span>
                      <span className="text-border">·</span>
                      <span>{activeFile.size}</span>
                    </div>
                  </div>
                  <div className="border-t border-border/60" />
                  <div className="flex-1 overflow-y-auto px-8 py-6">
                    <MarkdownPreview content={activeFile.content} />
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
              <File size={28} className="text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">
                Selecciona un archivo
              </p>
            </div>
          )
        ) : (
          <div className="p-4">
            <ReviewPanel diffs={diffs} onOpenFile={onOpenFile} />
          </div>
        )}
      </div>
    </div>
  );
}

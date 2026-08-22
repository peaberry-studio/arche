"use client";

import { useCallback, useRef, useState } from "react";
import { FileMagnifyingGlass, Info, X } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DiffViewer } from "@/components/ui/diff-viewer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { KnowledgeReviewList } from "@/components/workspace/knowledge-review-list";
import { MarkdownEditor } from "@/components/workspace/markdown-editor";
import { MarkdownPreview } from "@/components/workspace/markdown-preview";
import { PublishKbButton } from "@/components/workspace/publish-kb-button";
import { ReviewPanel } from "@/components/workspace/review-panel";
import { SegmentedControl, type SegmentedControlOption } from "@/components/workspace/segmented-control";
import { useEditorDrafts } from "@/hooks/use-editor-drafts";
import type { WorkspaceDiff } from "@/hooks/use-workspace";
import { createUnifiedDiff } from "@/lib/line-diff";
import type { KnowledgeReviewChange } from "@/types/learning";

type CuratorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  workspaceAgentEnabled?: boolean;
  diffs: WorkspaceDiff[];
  isLoadingDiffs?: boolean;
  diffsError?: string | null;
  onOpenFile: (path: string) => void;
  internalLinkPaths?: string[];
  onDiscardFileChanges?: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onPublish?: () => void;
  onResolveConflict?: (path: string) => void | Promise<void>;
  onKnowledgeReviewApplied?: () => void | Promise<void>;
  onProposalCountChange?: (count: number) => void;
  knowledgeReviewRefreshKey?: number;
};

type CuratorTab = "proposals" | "manual-edits";

const TABS: SegmentedControlOption<CuratorTab>[] = [
  { value: "proposals", label: "Proposals" },
  { value: "manual-edits", label: "Manual edits" },
];

type ViewerTab = "preview" | "edit" | "diff";

const VIEWER_TABS: SegmentedControlOption<ViewerTab>[] = [
  { value: "preview", label: "Preview" },
  { value: "edit", label: "Edit" },
  { value: "diff", label: "Diff" },
];

const OPERATION_BADGE_VARIANTS: Record<KnowledgeReviewChange["operation"], 'success' | 'default' | 'warning'> = {
  create: 'success',
  update: 'default',
  delete: 'warning',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function draftSaveError(data: unknown): string {
  if (isRecord(data) && typeof data.error === "string") {
    return data.error;
  }
  return "Could not save your edit. Try again.";
}

export function CuratorDialog({
  open,
  onOpenChange,
  slug,
  workspaceAgentEnabled = true,
  diffs,
  isLoadingDiffs = false,
  diffsError = null,
  onOpenFile,
  internalLinkPaths,
  onDiscardFileChanges,
  onPublish,
  onResolveConflict,
  onKnowledgeReviewApplied,
  onProposalCountChange,
  knowledgeReviewRefreshKey = 0,
}: CuratorDialogProps) {
  const [tab, setTab] = useState<CuratorTab>("proposals");
  const [selected, setSelected] = useState<KnowledgeReviewChange | null>(null);
  const [viewerTab, setViewerTab] = useState<ViewerTab>("preview");
  const [proposalCount, setProposalCount] = useState(0);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const drafts = useEditorDrafts({
    onSave: async (changeId, content) => {
      try {
        const response = await fetch(`/api/u/${slug}/learning/proposals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save_draft", proposalId: changeId, content }),
        });
        if (!response.ok) {
          const data: unknown = await response.json().catch(() => null);
          return { ok: false, error: draftSaveError(data) };
        }
        return { ok: true };
      } catch {
        return { ok: false, error: draftSaveError(null) };
      }
    },
  });

  const handleOpenProposal = useCallback((change: KnowledgeReviewChange) => {
    setSelected(change);
    setViewerTab("preview");
  }, []);

  const handleTabChange = useCallback((next: CuratorTab) => {
    setTab(next);
    setSelected(null);
  }, []);

  const handleProposalCountChange = useCallback((count: number) => {
    setProposalCount(count);
    onProposalCountChange?.(count);
  }, [onProposalCountChange]);

  const tabOptions = TABS.map((option) => (
    option.value === "proposals"
      ? { ...option, badge: proposalCount }
      : { ...option, badge: diffs.length }
  ));

  const selectedContent = selected
    ? drafts.getDraft(selected.id, selected.proposedContent)
    : null;

  const hasConflictedDiffs = diffs.some((diff) => diff.conflicted);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className="flex h-[min(88vh,54rem)] w-[min(96vw,84rem)] max-w-none flex-col gap-0 p-0 outline-none sm:rounded-2xl"
        tabIndex={-1}
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <div
          data-testid="curator-dialog-header"
          className="flex shrink-0 items-center border-b border-border/40 px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <DialogTitle className="text-base">Curator</DialogTitle>
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground"
                      aria-label="About the Curator"
                    >
                      <Info size={14} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[280px]">
                    Review agent and curator proposals, then publish workspace changes to the Knowledge Base.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <DialogDescription className="sr-only">
              Review agent and curator proposals, then publish workspace changes to the Knowledge Base.
            </DialogDescription>
          </div>

          <SegmentedControl
            variant="outline"
            size="sm"
            value={tab}
            onValueChange={handleTabChange}
            options={tabOptions}
          />

          <div className="flex shrink-0 items-center justify-end gap-2 flex-1">
            {tab === "manual-edits" && workspaceAgentEnabled && diffs.length > 0 ? (
              <PublishKbButton
                slug={slug}
                onComplete={onPublish}
                disabled={hasConflictedDiffs}
                disabledReason={hasConflictedDiffs ? "Resolve conflicts before publishing" : undefined}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              aria-label="Close curator"
            >
              <X size={16} weight="bold" />
            </Button>
          </div>
        </div>

        {tab === "manual-edits" ? (
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-custom p-4">
            <ReviewPanel
              slug={slug}
              diffs={diffs}
              isLoading={isLoadingDiffs}
              error={diffsError ?? undefined}
              onOpenFile={onOpenFile}
              onDiscardFileChanges={onDiscardFileChanges}
              onResolveConflict={onResolveConflict}
              onPublishFile={onPublish}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex w-[40%] min-w-[22rem] flex-col border-r border-border/30">
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-custom p-4">
                <KnowledgeReviewList
                  slug={slug}
                  refreshKey={knowledgeReviewRefreshKey}
                  drafts={drafts}
                  onApplied={onKnowledgeReviewApplied}
                  onOpenCountChange={handleProposalCountChange}
                  onOpenProposal={handleOpenProposal}
                />
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              {selected ? (
                <>
                  <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/30 px-4">
                    <Badge
                      variant={OPERATION_BADGE_VARIANTS[selected.operation]}
                      className="shrink-0 px-1.5 py-0 text-[10px] capitalize"
                    >
                      {selected.operation}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={selected.title}>
                      {selected.title}
                    </span>
                    <SegmentedControl
                      variant="outline"
                      size="sm"
                      value={viewerTab}
                      onValueChange={setViewerTab}
                      options={VIEWER_TABS}
                    />
                  </div>
                  {viewerTab === "preview" ? (
                    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-custom">
                      {selected.reason ? (
                        <div className="px-4 pt-4">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Reason
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{selected.reason}</p>
                          <div className="my-4 border-t border-border/30" />
                        </div>
                      ) : null}
                      <div className="px-4 pb-4">
                        <MarkdownPreview content={selectedContent || "_Delete this file_"} />
                      </div>
                    </div>
                  ) : viewerTab === "edit" ? (
                    <div className="min-h-0 flex-1">
                      <MarkdownEditor
                        key={selected.id}
                        value={selectedContent ?? ""}
                        onChange={(next) => drafts.handleChange(selected.id, next, selected.proposedContent)}
                        saveState={drafts.getSaveState(selected.id)}
                        saveError={drafts.getSaveError(selected.id)}
                        internalLinkPaths={internalLinkPaths}
                        onOpenInternalLink={onOpenFile}
                      />
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-custom p-4">
                      <div className="overflow-hidden rounded-md border border-border/30 bg-foreground/[0.015]">
                        <DiffViewer
                          diff={createUnifiedDiff({
                            oldText:
                              selected.status === "needs_rebase"
                                ? selected.actualContent ?? selected.baseContent ?? ""
                                : selected.baseContent ?? "",
                            newText: selectedContent ?? "",
                            path: selected.kbPath,
                            operation: selected.operation,
                          })}
                        />
                        <div className="border-t border-border/30 px-3 py-1.5 text-[11px] text-muted-foreground">
                          <span className="font-mono" title={selected.kbPath}>
                            {selected.kbPath}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                  <FileMagnifyingGlass size={28} className="text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">Select a proposal to preview and edit it.</p>
                  <p className="max-w-[320px] text-[11px] leading-relaxed text-muted-foreground/70">
                    Adjust a proposal in the Edit tab, then apply it from the list.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowSquareOut, GitPullRequest, X } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DiffViewer } from "@/components/ui/diff-viewer";
import { KnowledgeReviewList } from "@/components/workspace/knowledge-review-list";
import { MarkdownPreview } from "@/components/workspace/markdown-preview";
import { PublishKbButton } from "@/components/workspace/publish-kb-button";
import { ReviewPanel, type ReviewTab } from "@/components/workspace/review-panel";
import { SegmentedControl, type SegmentedControlOption } from "@/components/workspace/segmented-control";
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

const TABS: SegmentedControlOption<ReviewTab>[] = [
  { value: "proposals", label: "Proposals" },
  { value: "changes", label: "Pending publish" },
];

type SelectedProposal = {
  change: KnowledgeReviewChange;
  content: string;
};

const OPERATION_BADGE_VARIANTS: Record<KnowledgeReviewChange["operation"], 'success' | 'default' | 'warning'> = {
  create: 'success',
  update: 'default',
  delete: 'warning',
};

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
  const router = useRouter();
  const [tab, setTab] = useState<ReviewTab>("proposals");
  const [selected, setSelected] = useState<SelectedProposal | null>(null);

  const handleOpenProposal = useCallback((change: KnowledgeReviewChange, content: string) => {
    setSelected({ change, content });
  }, []);

  const handleOpenInExplore = useCallback(() => {
    if (!selected) return;
    router.push(`/w/${slug}/explore?path=${encodeURIComponent(selected.change.kbPath)}`);
  }, [router, selected, slug]);

  const selectedProposal = selected?.change ?? null;
  const selectedContent = selected?.content ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(88vh,54rem)] w-[min(96vw,84rem)] max-w-none flex-col gap-0 p-0 sm:rounded-2xl"
        showCloseButton={false}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-5 py-3.5">
          <div className="min-w-0">
            <DialogTitle className="text-base">Curator</DialogTitle>
            <DialogDescription className="mt-0.5">
              Review agent and curator proposals, then publish workspace changes to the Knowledge Base.
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {workspaceAgentEnabled && diffs.length > 0 ? (
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

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col border-r border-border/30">
            <div className="flex h-12 shrink-0 items-center border-b border-border/30 px-4">
              <SegmentedControl
                variant="outline"
                size="sm"
                value={tab}
                onValueChange={setTab}
                options={TABS}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-custom px-4 pb-8 pt-3">
              {tab === "proposals" ? (
                <KnowledgeReviewList
                  slug={slug}
                  refreshKey={knowledgeReviewRefreshKey}
                  onApplied={onKnowledgeReviewApplied}
                  onOpenCountChange={onProposalCountChange}
                  onOpenProposal={handleOpenProposal}
                  onOpenFile={onOpenFile}
                  internalLinkPaths={internalLinkPaths}
                />
              ) : (
                <ReviewPanel
                  slug={slug}
                  diffs={diffs}
                  activeTab="changes"
                  isLoading={isLoadingDiffs}
                  error={diffsError ?? undefined}
                  onOpenFile={onOpenFile}
                  internalLinkPaths={internalLinkPaths}
                  onDiscardFileChanges={onDiscardFileChanges}
                  onResolveConflict={onResolveConflict}
                />
              )}
            </div>
          </div>

          <div className="flex w-[min(42%,30rem)] shrink-0 flex-col">
            {selectedProposal ? (
              <>
                <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/30 px-4">
                  <Badge
                    variant={OPERATION_BADGE_VARIANTS[selectedProposal.operation]}
                    className="shrink-0 px-1.5 py-0 text-[10px] capitalize"
                  >
                    {selectedProposal.operation}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {selectedProposal.title}
                  </span>
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    onClick={handleOpenInExplore}
                  >
                    <ArrowSquareOut size={12} weight="bold" />
                    Open in Explore
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-custom px-4 py-4">
                  <div className="space-y-4">
                    <div>
                      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Preview
                      </p>
                      <div className="rounded-lg border border-border/30 bg-foreground/[0.015] p-3">
                        <MarkdownPreview content={selectedContent || "_Delete this file_"} />
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Diff
                      </p>
                      <div className="overflow-hidden rounded-md border border-border/30 bg-foreground/[0.015]">
                        <DiffViewer
                          diff={createUnifiedDiff({
                            oldText:
                              selectedProposal.status === "needs_rebase"
                                ? selectedProposal.actualContent ?? selectedProposal.baseContent ?? ""
                                : selectedProposal.baseContent ?? "",
                            newText: selectedContent ?? "",
                            path: selectedProposal.kbPath,
                            operation: selectedProposal.operation,
                          })}
                        />
                        <div className="border-t border-border/30 px-3 py-1.5 text-[11px] text-muted-foreground">
                          <span className="font-mono" title={selectedProposal.kbPath}>
                            {selectedProposal.kbPath}
                          </span>
                        </div>
                      </div>
                    </div>
                    {selectedProposal.reason ? (
                      <div>
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Reason
                        </p>
                        <p className="rounded-lg border border-border/30 bg-foreground/[0.015] p-3 text-xs text-muted-foreground">
                          {selectedProposal.reason}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <GitPullRequest size={28} className="text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  Select a proposal to preview its diff. For deeper edits, open it in Explore.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

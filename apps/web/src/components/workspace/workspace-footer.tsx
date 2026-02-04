"use client";

import { SidebarSimple, SquareHalf } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

type WorkspaceFooterProps = {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  pendingDiffs?: number;
  onOpenReview?: () => void;
};

export function WorkspaceFooter({
  leftCollapsed,
  rightCollapsed,
  onToggleLeft,
  onToggleRight,
  pendingDiffs = 0,
  onOpenReview
}: WorkspaceFooterProps) {
  const showReviewBadge = pendingDiffs > 0 && rightCollapsed;
  const badgeLabel = pendingDiffs > 99 ? "99+" : String(pendingDiffs);

  const handleRightClick = () => {
    if (showReviewBadge && onOpenReview) {
      onOpenReview();
      return;
    }
    onToggleRight();
  };

  return (
    <footer className="relative z-20 border-t border-border/60 bg-card/80 backdrop-blur-sm">
      <div className="flex h-8 w-full items-center justify-between px-2">
        <button
          type="button"
          onClick={onToggleLeft}
          className={cn(
            "flex items-center justify-center rounded p-1.5 transition-colors hover:bg-muted/50",
            leftCollapsed
              ? "text-muted-foreground hover:text-foreground"
              : "text-foreground"
          )}
          aria-label={leftCollapsed ? "Show files" : "Hide files"}
        >
          <SidebarSimple size={17} weight={leftCollapsed ? "regular" : "bold"} />
        </button>

        <button
          type="button"
          onClick={handleRightClick}
          className={cn(
            "relative flex items-center justify-center rounded p-1.5 transition-colors hover:bg-muted/50",
            rightCollapsed
              ? "text-muted-foreground hover:text-foreground"
              : "text-foreground"
          )}
          aria-label={rightCollapsed ? "Show inspector" : "Hide inspector"}
        >
          <SquareHalf size={17} weight={rightCollapsed ? "regular" : "bold"} />
          {showReviewBadge ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {badgeLabel}
            </span>
          ) : null}
        </button>
      </div>
    </footer>
  );
}

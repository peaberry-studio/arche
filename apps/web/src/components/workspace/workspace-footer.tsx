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
    <footer className="glass-bar relative z-20 shrink-0 rounded-2xl text-card-foreground">
      <div className="flex h-9 w-full items-center justify-between px-4">
        <button
          type="button"
          onClick={onToggleLeft}
          className={cn(
            "flex items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-foreground/5",
            leftCollapsed
              ? "text-muted-foreground hover:text-foreground"
              : "text-foreground"
          )}
          aria-label={leftCollapsed ? "Show files" : "Hide files"}
        >
          <SidebarSimple size={18} weight={leftCollapsed ? "regular" : "bold"} />
        </button>

        <button
          type="button"
          onClick={handleRightClick}
          className={cn(
            "relative flex items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-foreground/5",
            rightCollapsed
              ? "text-muted-foreground hover:text-foreground"
              : "text-foreground"
          )}
          aria-label={rightCollapsed ? "Show inspector" : "Hide inspector"}
        >
          <SquareHalf size={18} weight={rightCollapsed ? "regular" : "bold"} />
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

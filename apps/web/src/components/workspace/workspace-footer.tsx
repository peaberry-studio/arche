"use client";

import { SidebarSimple, SquareHalf } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type ConnectorStatus = "ready" | "pending" | "disabled";

type ConnectorSummary = {
  id: string;
  name: string;
  type: string;
  status: ConnectorStatus;
};

type WorkspaceFooterProps = {
  slug: string;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  pendingDiffs?: number;
  onOpenReview?: () => void;
};

export function WorkspaceFooter({
  slug,
  leftCollapsed,
  rightCollapsed,
  onToggleLeft,
  onToggleRight,
  pendingDiffs = 0,
  onOpenReview
}: WorkspaceFooterProps) {
  const showReviewBadge = pendingDiffs > 0 && rightCollapsed;
  const badgeLabel = pendingDiffs > 99 ? "99+" : String(pendingDiffs);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [isLoadingConnectors, setIsLoadingConnectors] = useState(true);

  const handleRightClick = () => {
    if (showReviewBadge && onOpenReview) {
      onOpenReview();
      return;
    }
    onToggleRight();
  };

  useEffect(() => {
    let cancelled = false;

    const loadConnectors = async () => {
      try {
        const response = await fetch(`/api/u/${slug}/connectors`, { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as
          | { connectors?: ConnectorSummary[] }
          | null;

        if (!response.ok || cancelled) return;
        const next = Array.isArray(data?.connectors) ? data.connectors : [];
        setConnectors(next);
      } finally {
        if (!cancelled) setIsLoadingConnectors(false);
      }
    };

    loadConnectors().catch(() => {
      if (!cancelled) setIsLoadingConnectors(false);
    });

    const interval = setInterval(loadConnectors, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [slug]);

  const activeConnectors = useMemo(
    () => connectors.filter((connector) => connector.status === "ready").length,
    [connectors]
  );

  const statusInfo = (status: ConnectorStatus): { label: string; dotClassName: string } => {
    if (status === "ready") {
      return { label: "Working", dotClassName: "bg-emerald-500" };
    }
    if (status === "pending") {
      return { label: "Pending", dotClassName: "bg-amber-500" };
    }
    return { label: "Not working", dotClassName: "bg-rose-500" };
  };

  return (
    <footer className="glass-bar relative z-20 shrink-0 rounded-2xl text-card-foreground">
      <div className="grid h-9 w-full grid-cols-3 items-center px-4">
        <div className="justify-self-start">
          <button
            type="button"
            onClick={onToggleLeft}
            className={cn(
              "flex items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-foreground/5",
              leftCollapsed ? "text-muted-foreground hover:text-foreground" : "text-foreground"
            )}
            aria-label={leftCollapsed ? "Show files" : "Hide files"}
          >
            <SidebarSimple size={18} weight={leftCollapsed ? "regular" : "bold"} />
          </button>
        </div>

        <div className="justify-self-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-lg px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                aria-label="Open connectors status"
              >
                {isLoadingConnectors ? "Connectors..." : `${activeConnectors} active connectors`}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" className="w-72">
              <DropdownMenuLabel>Connector status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {connectors.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No connectors configured.</p>
              ) : (
                <div className="space-y-1 px-1 py-1">
                  {connectors.map((connector) => {
                    const info = statusInfo(connector.status);
                    return (
                      <div
                        key={connector.id}
                        className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{connector.name}</p>
                          <p className="text-[11px] text-muted-foreground">{connector.type}</p>
                        </div>
                        <div className="ml-3 flex items-center gap-1.5 text-muted-foreground">
                          <span className={cn("h-2 w-2 rounded-full", info.dotClassName)} />
                          <span>{info.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="justify-self-end">
          <button
            type="button"
            onClick={handleRightClick}
            className={cn(
              "relative flex items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-foreground/5",
              rightCollapsed ? "text-muted-foreground hover:text-foreground" : "text-foreground"
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
      </div>
    </footer>
  );
}

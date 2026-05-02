"use client";

import { useEffect, useMemo, useRef } from "react";
import { ChatCircle, CheckSquare, Circle, Plus, SpinnerGap } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { groupByDateBucket } from "@/lib/date-buckets";
import type { WorkspaceSession } from "@/lib/opencode/types";

type SessionsPanelProps = {
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  unseenCompletedSessions: ReadonlySet<string>;
  onLoadMore?: () => void;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  kind?: "chats" | "tasks";
  query?: string;
};

export function SessionsPanel({
  sessions,
  activeSessionId,
  hasMore = false,
  isLoadingMore = false,
  unseenCompletedSessions,
  onLoadMore,
  onSelectSession,
  onCreateSession,
  kind = "chats",
  query = "",
}: SessionsPanelProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const filteredSessions = useMemo(() => {
    if (!normalizedQuery) return sessions;
    return sessions.filter((session) =>
      session.title.toLowerCase().includes(normalizedQuery) ||
      session.autopilot?.taskName.toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery, sessions]);

  const buckets = useMemo(
    () => groupByDateBucket(filteredSessions, (s) => s.updatedAtRaw),
    [filteredSessions]
  );

  const getIndicatorClassName = (session: WorkspaceSession): string | null => {
    if (session.status === "busy") return "text-amber-400";
    if (session.status === "error") return "text-red-400";
    if (session.autopilot?.hasUnseenResult) return "text-green-400";
    if (unseenCompletedSessions.has(session.id)) return "text-green-400";
    return null;
  };

  const emptyLabel = kind === "tasks" ? "No tasks yet" : "No chats yet";
  const emptySearchLabel = kind === "tasks" ? "No tasks found" : "No chats found";
  const loadingLabel = kind === "tasks" ? "Loading more tasks..." : "Loading more chats...";
  const moreLabel = kind === "tasks" ? "Scroll for older tasks" : "Scroll for older chats";

  useEffect(() => {
    if (!hasMore || isLoadingMore || !onLoadMore) {
      return;
    }

    const root = scrollContainerRef.current;
    const target = loadMoreRef.current;
    if (!root || !target || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void onLoadMore();
        }
      },
      {
        root,
        rootMargin: "0px 0px 160px 0px",
      }
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoadingMore, onLoadMore]);

  if (sessions.length === 0) {
    const EmptyIcon = kind === "tasks" ? CheckSquare : ChatCircle;
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <EmptyIcon size={24} weight="bold" className="text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
          {kind === "chats" ? (
            <Button size="sm" className="h-7 px-2 text-xs" onClick={onCreateSession}>
              <Plus size={12} weight="bold" className="mr-1" />
              New chat
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (filteredSessions.length === 0) {
    const EmptySearchIcon = kind === "tasks" ? CheckSquare : ChatCircle;
    return (
      <div className="flex flex-1 flex-col">
        {kind === "chats" ? (
          <div className="px-3 pb-2 pt-3">
            <Button size="sm" className="w-full" onClick={onCreateSession}><Plus size={14} weight="bold" className="mr-1.5" />New chat</Button>
          </div>
        ) : null}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <EmptySearchIcon size={24} weight="bold" className="text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">{emptySearchLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-2 pb-4 pt-1 scrollbar-none">
      {buckets.map((bucket) => (
        <div key={bucket.label} className="mb-3">
          <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {bucket.label}
          </div>
          <div className="space-y-0.5">
            {bucket.items.map((session) => {
              const indicatorClassName = getIndicatorClassName(session);
              const hasIndicator = indicatorClassName !== null;
              const primaryTitle =
                kind === "tasks" && session.autopilot
                  ? session.autopilot.taskName
                  : session.title;
              const secondaryLabel =
                kind === "tasks" && session.autopilot && session.title !== session.autopilot.taskName
                  ? session.title
                  : session.autopilot && kind !== "tasks"
                    ? session.autopilot.taskName
                    : null;

              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  className={cn(
                    "group/session flex w-full items-center gap-0 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                    "hover:bg-foreground/5",
                    activeSessionId === session.id
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/80"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "overflow-hidden transition-[width,margin,opacity] duration-200 ease-out",
                      hasIndicator ? "mr-2 w-2 opacity-100" : "mr-0 w-0 opacity-0"
                    )}
                  >
                    <Circle
                      size={8}
                      weight="fill"
                      className={cn("shrink-0", indicatorClassName ?? "text-transparent")}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{primaryTitle}</span>
                      {session.autopilot && kind !== "tasks" ? (
                        <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                          Auto
                        </span>
                      ) : null}
                    </span>
                    {secondaryLabel ? (
                      <span className="block truncate text-[11px] text-muted-foreground/70">
                        {secondaryLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-0 shrink-0 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground/60 opacity-0 transition-all duration-200 group-hover/session:max-w-24 group-hover/session:opacity-100">
                    {session.updatedAt}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {hasMore || isLoadingMore ? (
        <div ref={loadMoreRef} className="flex items-center justify-center px-2 py-3 text-xs text-muted-foreground">
          {isLoadingMore ? (
            <span className="inline-flex items-center gap-2">
              <SpinnerGap size={14} className="animate-spin" />
              {loadingLabel}
            </span>
          ) : (
            <span>{moreLabel}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

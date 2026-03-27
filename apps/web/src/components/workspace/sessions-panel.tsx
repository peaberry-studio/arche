"use client";

import { useMemo } from "react";
import { ChatCircle, Circle, Plus } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { groupByDateBucket } from "@/lib/date-buckets";
import type { WorkspaceSession } from "@/lib/opencode/types";

type SessionsPanelProps = {
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  unseenCompletedSessions: ReadonlySet<string>;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  query?: string;
};

export function SessionsPanel({
  sessions,
  activeSessionId,
  unseenCompletedSessions,
  onSelectSession,
  onCreateSession,
  query = "",
}: SessionsPanelProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSessions = useMemo(() => {
    if (!normalizedQuery) return sessions;
    return sessions.filter((session) =>
      session.title.toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery, sessions]);

  const buckets = useMemo(
    () => groupByDateBucket(filteredSessions, (s) => s.updatedAtRaw),
    [filteredSessions]
  );

  const getIndicatorClassName = (session: WorkspaceSession): string | null => {
    if (session.status === "busy") return "text-amber-400";
    if (session.status === "error") return "text-red-400";
    if (unseenCompletedSessions.has(session.id)) return "text-green-400";
    return null;
  };

  if (sessions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <ChatCircle size={24} weight="bold" className="text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">No chats yet</p>
          <Button size="sm" className="h-7 px-2 text-xs" onClick={onCreateSession}>
            <Plus size={12} weight="bold" className="mr-1" />
            New chat
          </Button>
        </div>
      </div>
    );
  }

  if (filteredSessions.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="px-3 pt-3 pb-2">
          <Button size="sm" className="w-full" onClick={onCreateSession}><Plus size={14} weight="bold" className="mr-1.5" />New chat</Button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <ChatCircle size={24} weight="bold" className="text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">No chats found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-4 pt-1 scrollbar-none">
      {buckets.map((bucket) => (
        <div key={bucket.label} className="mb-3">
          <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {bucket.label}
          </div>
          <div className="space-y-0.5">
            {bucket.items.map((session) => {
              const indicatorClassName = getIndicatorClassName(session);
              const hasIndicator = indicatorClassName !== null;

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
                  <span className="flex-1 truncate font-medium">{session.title}</span>
                  <span className="max-w-0 shrink-0 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground/60 opacity-0 transition-all duration-200 group-hover/session:max-w-24 group-hover/session:opacity-100">
                    {session.updatedAt}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

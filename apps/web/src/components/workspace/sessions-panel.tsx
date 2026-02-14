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
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  query?: string;
};

export function SessionsPanel({
  sessions,
  activeSessionId,
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

  if (sessions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <ChatCircle size={24} weight="bold" className="text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">No chats yet</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={onCreateSession}
          >
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
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onCreateSession}><Plus size={14} weight="bold" className="mr-1.5" />New chat</Button>
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
            {bucket.items.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelectSession(session.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                  "hover:bg-foreground/5",
                  activeSessionId === session.id
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/80"
                )}
              >
                <Circle
                  size={8}
                  weight="fill"
                  className={cn(
                    "shrink-0",
                    session.status === "busy"
                      ? "text-green-400"
                      : session.status === "error"
                        ? "text-red-400"
                        : "text-muted-foreground/40"
                  )}
                />
                <span className="flex-1 truncate font-medium">{session.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground/60">
                  {session.updatedAt}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

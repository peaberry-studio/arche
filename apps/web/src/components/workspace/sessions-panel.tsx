"use client";

import { useMemo } from "react";
import { ChatCircle, Circle } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { groupByDateBucket } from "@/lib/date-buckets";
import type { WorkspaceSession } from "@/lib/opencode/types";

type SessionsPanelProps = {
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
};

export function SessionsPanel({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
}: SessionsPanelProps) {
  const buckets = useMemo(
    () => groupByDateBucket(sessions, (s) => s.updatedAtRaw),
    [sessions]
  );

  if (sessions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <div className="w-full px-3 pb-2">
          <Button className="w-full" onClick={onCreateSession}>New session</Button>
        </div>
        <ChatCircle size={24} weight="bold" className="text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">No sessions yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-4 pt-2 scrollbar-none">
      <div className="px-1 pb-2">
        <Button className="w-full" onClick={onCreateSession}>New session</Button>
      </div>
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

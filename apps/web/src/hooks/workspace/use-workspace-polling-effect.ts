"use client";

import { useEffect, type MutableRefObject } from "react";

import type { WorkspaceSession } from "@/lib/opencode/types";

export function useWorkspacePollingEffect({
  activeSessionIdRef,
  enabled,
  isConnected,
  loadSessions,
  pollInterval,
  refreshDiffs,
  sessionsRef,
}: {
  activeSessionIdRef: MutableRefObject<string | null>;
  enabled: boolean;
  isConnected: boolean;
  loadSessions: () => Promise<void>;
  pollInterval: number;
  refreshDiffs: (options?: { force?: boolean }) => Promise<void>;
  sessionsRef: MutableRefObject<WorkspaceSession[]>;
}) {
  useEffect(() => {
    if (!enabled || !isConnected || pollInterval <= 0) return;

    const interval = setInterval(() => {
      loadSessions();

      // Diff refresh while busy keeps the git panel live. Message polling is
      // gone: the event bus is the only message source.
      const currentSessions = sessionsRef.current;
      if (currentSessions.some((session) => session.status === "busy")) {
        refreshDiffs();
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [
    activeSessionIdRef,
    enabled,
    isConnected,
    loadSessions,
    pollInterval,
    refreshDiffs,
    sessionsRef,
  ]);
}

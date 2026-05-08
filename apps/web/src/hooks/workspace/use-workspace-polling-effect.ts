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
  refreshMessages,
  sessionsRef,
}: {
  activeSessionIdRef: MutableRefObject<string | null>;
  enabled: boolean;
  isConnected: boolean;
  loadSessions: () => Promise<void>;
  pollInterval: number;
  refreshDiffs: () => Promise<void>;
  refreshMessages: (sessionIdOverride?: string) => Promise<void>;
  sessionsRef: MutableRefObject<WorkspaceSession[]>;
}) {
  useEffect(() => {
    if (!enabled || !isConnected || pollInterval <= 0) return;

    const interval = setInterval(() => {
      loadSessions();

      const currentSessions = sessionsRef.current;
      const currentActiveSessionId = activeSessionIdRef.current;
      const hasBusySessions = currentSessions.some(
        (session) => session.status === "busy"
      );

      if (hasBusySessions) {
        refreshDiffs();
      }

      const sessionIdsToRefresh = new Set<string>();
      currentSessions.forEach((session) => {
        if (session.status === "busy") {
          sessionIdsToRefresh.add(session.id);
        }
      });
      if (
        currentActiveSessionId &&
        currentSessions.some(
          (session) => session.id === currentActiveSessionId && session.status === "busy"
        )
      ) {
        sessionIdsToRefresh.add(currentActiveSessionId);
      }

      sessionIdsToRefresh.forEach((sessionId) => {
        void refreshMessages(sessionId);
      });
    }, pollInterval);

    return () => clearInterval(interval);
  }, [
    activeSessionIdRef,
    enabled,
    isConnected,
    loadSessions,
    pollInterval,
    refreshDiffs,
    refreshMessages,
    sessionsRef,
  ]);
}

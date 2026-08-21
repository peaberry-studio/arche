"use client";

import { useEffect } from "react";

export function useWorkspacePollingEffect({
  enabled,
  isConnected,
  loadSessions,
  pollInterval,
}: {
  enabled: boolean;
  isConnected: boolean;
  loadSessions: () => Promise<void>;
  pollInterval: number;
}) {
  useEffect(() => {
    if (!enabled || !isConnected || pollInterval <= 0) return;

    const interval = setInterval(() => {
      loadSessions();
    }, pollInterval);

    return () => clearInterval(interval);
  }, [enabled, isConnected, loadSessions, pollInterval]);
}

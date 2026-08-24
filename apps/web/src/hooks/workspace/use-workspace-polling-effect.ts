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

    const refreshIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadSessions();
    };

    const interval = setInterval(refreshIfVisible, pollInterval);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshIfVisible();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, isConnected, loadSessions, pollInterval]);
}

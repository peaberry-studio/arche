"use client";

import { useEffect } from "react";

export function useWorkspaceActiveSessionEffects({
  activeSessionId,
  enabled,
  isConnected,
  ensureSessionFamilyLoaded,
  refreshMessages,
}: {
  activeSessionId: string | null;
  enabled: boolean;
  isConnected: boolean;
  ensureSessionFamilyLoaded: (sessionId: string) => Promise<void>;
  refreshMessages: (sessionIdOverride?: string) => Promise<void>;
}) {
  useEffect(() => {
    if (activeSessionId && enabled && isConnected) {
      refreshMessages(activeSessionId);
    }
  }, [activeSessionId, enabled, isConnected, refreshMessages]);

  useEffect(() => {
    if (!activeSessionId || !enabled || !isConnected) return;
    void ensureSessionFamilyLoaded(activeSessionId);
  }, [activeSessionId, ensureSessionFamilyLoaded, enabled, isConnected]);
}

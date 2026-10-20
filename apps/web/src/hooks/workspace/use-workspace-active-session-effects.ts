"use client";

import { useEffect } from "react";

export function useWorkspaceActiveSessionEffects({
  activeSessionId,
  enabled,
  isConnected,
  isArchived = false,
  ensureSessionFamilyLoaded,
  refreshMessages,
}: {
  activeSessionId: string | null;
  enabled: boolean;
  isConnected: boolean;
  isArchived?: boolean;
  ensureSessionFamilyLoaded: (sessionId: string) => Promise<void>;
  refreshMessages: (sessionIdOverride?: string) => Promise<void>;
}) {
  useEffect(() => {
    if (activeSessionId && ((enabled && isConnected) || isArchived)) {
      refreshMessages(activeSessionId);
    }
  }, [activeSessionId, enabled, isConnected, isArchived, refreshMessages]);

  useEffect(() => {
    if (!activeSessionId || (!(enabled && isConnected) && !isArchived)) return;
    void ensureSessionFamilyLoaded(activeSessionId);
  }, [activeSessionId, ensureSessionFamilyLoaded, enabled, isConnected, isArchived]);
}

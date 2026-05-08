"use client";

import { useEffect } from "react";

export function useWorkspaceInitialRefreshEffect({
  enabled,
  isConnected,
  refreshFiles,
  loadSessions,
  loadModels,
  loadAgentCatalog,
  refreshDiffs,
}: {
  enabled: boolean;
  isConnected: boolean;
  refreshFiles: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadModels: () => Promise<void>;
  loadAgentCatalog: () => Promise<void>;
  refreshDiffs: (options?: { force?: boolean }) => Promise<void>;
}) {
  useEffect(() => {
    if (!enabled || !isConnected) return;

    void Promise.all([
      refreshFiles(),
      loadSessions(),
      loadModels(),
      loadAgentCatalog(),
      refreshDiffs({ force: true }),
    ]);
  }, [
    enabled,
    isConnected,
    refreshFiles,
    loadSessions,
    loadModels,
    loadAgentCatalog,
    refreshDiffs,
  ]);
}

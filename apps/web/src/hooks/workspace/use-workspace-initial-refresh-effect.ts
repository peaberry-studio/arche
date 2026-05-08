"use client";

import type { MutableRefObject } from "react";

export function useWorkspaceInitialRefreshEffect({
  onConnectedRef,
  refreshFiles,
  loadSessions,
  loadModels,
  loadAgentCatalog,
  refreshDiffs,
}: {
  onConnectedRef: MutableRefObject<() => Promise<void>>;
  refreshFiles: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadModels: () => Promise<void>;
  loadAgentCatalog: () => Promise<void>;
  refreshDiffs: (options?: { force?: boolean }) => Promise<void>;
}) {
  onConnectedRef.current = async () => {
    await Promise.all([
      refreshFiles(),
      loadSessions(),
      loadModels(),
      loadAgentCatalog(),
      refreshDiffs({ force: true }),
    ]);
  };
}

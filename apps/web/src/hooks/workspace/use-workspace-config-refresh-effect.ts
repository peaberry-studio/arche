"use client";

import { useEffect } from "react";

import { WORKSPACE_CONFIG_STATUS_CHANGED_EVENT } from "@/lib/runtime/config-status-events";

export function useWorkspaceConfigRefreshEffect({
  enabled,
  isConnected,
  loadAgentCatalog,
  loadModels,
}: {
  enabled: boolean;
  isConnected: boolean;
  loadAgentCatalog: () => Promise<void>;
  loadModels: () => Promise<void>;
}) {
  useEffect(() => {
    if (!enabled || !isConnected) return;

    const handleWorkspaceConfigChanged = () => {
      void loadModels();
      void loadAgentCatalog();
    };

    window.addEventListener(
      WORKSPACE_CONFIG_STATUS_CHANGED_EVENT,
      handleWorkspaceConfigChanged
    );

    return () => {
      window.removeEventListener(
        WORKSPACE_CONFIG_STATUS_CHANGED_EVENT,
        handleWorkspaceConfigChanged
      );
    };
  }, [enabled, isConnected, loadAgentCatalog, loadModels]);
}

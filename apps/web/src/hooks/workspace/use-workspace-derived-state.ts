"use client";

import { useMemo } from "react";

import {
  getSessionSelectionKey,
  type AgentCatalogItem,
  type SessionSelectionState,
} from "@/hooks/workspace/workspace-types";
import type { AvailableModel, WorkspaceSession } from "@/types/workspace-runtime";

type UseWorkspaceDerivedStateOptions = {
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  sessionSelectionState: Record<string, SessionSelectionState>;
  primaryAgentId: AgentCatalogItem["id"] | null;
  agentDefaultModel: AvailableModel | null;
  models: AvailableModel[];
};

export function useWorkspaceDerivedState({
  sessions,
  activeSessionId,
  sessionSelectionState,
  primaryAgentId,
  agentDefaultModel,
  models,
}: UseWorkspaceDerivedStateOptions) {
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? null;

  const currentSessionSelection = useMemo(
    () =>
      sessionSelectionState[getSessionSelectionKey(activeSessionId)] ??
      { manualModel: null, runtimeModel: null, activeAgentId: primaryAgentId },
    [activeSessionId, primaryAgentId, sessionSelectionState]
  );

  const selectedModel = useMemo(
    () =>
      currentSessionSelection.manualModel ??
      currentSessionSelection.runtimeModel ??
      agentDefaultModel ??
      models[0] ??
      null,
    [agentDefaultModel, currentSessionSelection, models]
  );

  const hasManualModelSelection = currentSessionSelection.manualModel !== null;

  return {
    activeSession,
    selectedModel,
    hasManualModelSelection,
  };
}

"use client";

import { useMemo } from "react";

import type { AvailableModel, WorkspaceSession } from "@/lib/opencode/types";
import {
  getSessionSelectionKey,
  type AgentCatalogItem,
  type SessionSelectionState,
} from "@/hooks/workspace/workspace-types";

type UseWorkspaceDerivedStateOptions = {
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  sessionStreamStatus: Record<string, "submitted" | "streaming" | "error">;
  sessionSelectionState: Record<string, SessionSelectionState>;
  primaryAgentId: AgentCatalogItem["id"] | null;
  agentDefaultModel: AvailableModel | null;
  models: AvailableModel[];
};

export function useWorkspaceDerivedState({
  sessions,
  activeSessionId,
  sessionStreamStatus,
  sessionSelectionState,
  primaryAgentId,
  agentDefaultModel,
  models,
}: UseWorkspaceDerivedStateOptions) {
  const enrichedSessions = useMemo(() => {
    const hasStreaming = Object.keys(sessionStreamStatus).length > 0;
    if (!hasStreaming) return sessions;

    return sessions.map((session) => {
      const streamStatus = sessionStreamStatus[session.id];
      if (
        (streamStatus === "submitted" || streamStatus === "streaming") &&
        session.status !== "busy"
      ) {
        return { ...session, status: "busy" as const };
      }
      return session;
    });
  }, [sessions, sessionStreamStatus]);

  const activeSession =
    enrichedSessions.find((session) => session.id === activeSessionId) ?? null;

  const currentSessionSelection =
    sessionSelectionState[getSessionSelectionKey(activeSessionId)] ??
    { manualModel: null, runtimeModel: null, activeAgentId: primaryAgentId };

  const selectedModel =
    currentSessionSelection.manualModel ??
    currentSessionSelection.runtimeModel ??
    agentDefaultModel ??
    models[0] ??
    null;

  const hasManualModelSelection = currentSessionSelection.manualModel !== null;

  const isSending = useMemo(() => {
    if (!activeSessionId) return false;
    const status = sessionStreamStatus[activeSessionId];
    return status === "submitted" || status === "streaming";
  }, [activeSessionId, sessionStreamStatus]);

  return {
    activeSession,
    enrichedSessions,
    hasManualModelSelection,
    isSending,
    selectedModel,
  };
}

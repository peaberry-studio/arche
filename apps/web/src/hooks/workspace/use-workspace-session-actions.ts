"use client";

import { useCallback, type MutableRefObject, type SetStateAction } from "react";

import type { WorkspaceMessage, WorkspaceSession } from "@/lib/opencode/types";
import {
  PRE_SESSION_SELECTION_KEY,
  type SessionSelectionState,
} from "@/hooks/workspace/workspace-types";
import type { DeleteWorkspaceSessionResult } from "@/hooks/workspace/use-workspace-sessions";

type UseWorkspaceSessionActionsOptions = {
  createWorkspaceSession: (title?: string) => Promise<WorkspaceSession | null>;
  deleteWorkspaceSession: (id: string) => Promise<DeleteWorkspaceSessionResult | null>;
  resetSessions: (sessionIds: Set<string>) => void;
  clearSessionSelectionState: (sessionId: string) => void;
  initializeSessionSelectionState: (
    sessionId: string,
    selection?: SessionSelectionState
  ) => void;
  removeSessions: (sessionIds: Set<string>) => void;
  sessionSelectionStateRef: MutableRefObject<
    Record<string, SessionSelectionState>
  >;
  updateSessionMessages: (
    sessionId: string,
    updater: SetStateAction<WorkspaceMessage[]>
  ) => void;
};

export function useWorkspaceSessionActions({
  createWorkspaceSession,
  deleteWorkspaceSession,
  resetSessions,
  clearSessionSelectionState,
  initializeSessionSelectionState,
  removeSessions,
  sessionSelectionStateRef,
  updateSessionMessages,
}: UseWorkspaceSessionActionsOptions) {
  const cleanupDeletedSessions = useCallback(
    (sessionIds: Set<string>) => {
      resetSessions(sessionIds);
      for (const sessionId of sessionIds) {
        clearSessionSelectionState(sessionId);
      }
      removeSessions(sessionIds);
    },
    [clearSessionSelectionState, removeSessions, resetSessions]
  );

  const createSession = useCallback(
    async (title?: string) => {
      const result = await createWorkspaceSession(title);
      if (result) {
        const draftSelection = sessionSelectionStateRef.current[PRE_SESSION_SELECTION_KEY];
        updateSessionMessages(result.id, []);
        initializeSessionSelectionState(result.id, draftSelection);
        if (draftSelection) {
          clearSessionSelectionState(PRE_SESSION_SELECTION_KEY);
        }
      }
      return result;
    },
    [
      clearSessionSelectionState,
      createWorkspaceSession,
      initializeSessionSelectionState,
      sessionSelectionStateRef,
      updateSessionMessages,
    ]
  );

  const deleteSession = useCallback(
    async (id: string) => {
      const result = await deleteWorkspaceSession(id);
      if (!result) return false;

      cleanupDeletedSessions(result.deletedSessionIds);
      return true;
    },
    [cleanupDeletedSessions, deleteWorkspaceSession]
  );

  return {
    createSession,
    deleteSession,
  };
}

"use client";

import { useMemo, useState } from "react";

import {
  isSending as isSessionSending,
  overlaySessionRuntimeStatus,
} from "@/lib/opencode/event-reducer";
import { useInstanceHeartbeat } from "@/hooks/use-instance-heartbeat";
import { useWorkspaceConnection } from "@/hooks/use-workspace-connection";
import { useWorkspaceDiffs } from "@/hooks/use-workspace-diffs";
import { useWorkspaceFiles } from "@/hooks/use-workspace-files";
import {
  useWorkspaceActiveSessionEffects,
  useWorkspaceConfigRefreshEffect,
  useWorkspaceFlowSeenEffect,
  useWorkspaceInitialRefreshEffect,
  useWorkspacePollingEffect,
} from "@/hooks/workspace/use-workspace-effects";
import { useWorkspaceDerivedState } from "@/hooks/workspace/use-workspace-derived-state";
import { useWorkspaceEventBus } from "@/hooks/workspace/use-workspace-event-bus";
import { useWorkspaceMessageActions } from "@/hooks/workspace/use-workspace-message-actions";
import { useWorkspaceModelSelection } from "@/hooks/workspace/use-workspace-model-selection";
import { useWorkspaceSessionActions } from "@/hooks/workspace/use-workspace-session-actions";
import { useWorkspaceSessions } from "@/hooks/workspace/use-workspace-sessions";
import {
  EMPTY_WORKSPACE_MESSAGES,
  selectVisiblePermissions,
  type UseWorkspaceOptions,
  type UseWorkspaceReturn,
} from "@/hooks/workspace/workspace-types";

export type { WorkspaceDiff } from "@/hooks/use-workspace-diffs";
export type {
  AgentCatalogItem,
  UseWorkspaceOptions,
  UseWorkspaceReturn,
} from "@/hooks/workspace/workspace-types";
export { filterModelsByProviderStatus } from "@/hooks/workspace/workspace-types";

export function useWorkspace({
  slug,
  storageScope,
  initialSessionId = null,
  pollInterval = 5000,
  enabled = true,
  workspaceAgentEnabled = true,
  reaperEnabled = true,
}: UseWorkspaceOptions): UseWorkspaceReturn {
  // --- Sub-hooks ---
  const { connection, isConnected } = useWorkspaceConnection(slug, enabled);

  const files = useWorkspaceFiles(slug, workspaceAgentEnabled);
  const diffsHook = useWorkspaceDiffs(
    slug,
    enabled && workspaceAgentEnabled,
    isConnected
  );
  const { refreshDiffs, triggerDiffsRefresh } = diffsHook;
  useInstanceHeartbeat(slug, enabled && reaperEnabled);

  // Sessions
  const sessionsHook = useWorkspaceSessions({
    slug,
    storageScope,
    initialSessionId,
    isConnected: enabled && isConnected,
  });
  const {
    activeSessionId,
    activeSessionIdRef,
    createSession: createWorkspaceSession,
    deleteSession: deleteWorkspaceSession,
    ensureSessionFamilyLoaded,
    loadSessions,
    sessions: listedSessions,
    sessionsRef,
    markFlowRunSeen,
    markSessionCompleted,
  } = sessionsHook;

  const getActiveSessionId = () => activeSessionIdRef.current;
  const getSessions = () => sessionsRef.current;

  // Model selection
  const modelSelectionHook = useWorkspaceModelSelection({
    slug,
    getActiveSessionId,
  });
  const {
    agentDefaultModel,
    clearSessionSelectionState,
    initializeSessionSelectionState,
    loadAgentCatalog,
    loadModels,
    models,
    primaryAgentId,
    sessionSelectionState,
    sessionSelectionStateRef,
    syncRuntimeMetadataForSession,
  } = modelSelectionHook;

  // --- Single source of truth: the event-bus ChatStore ---
  const eventBus = useWorkspaceEventBus({
    slug,
    getActiveSessionId,
    getSessions,
    refreshDiffs: triggerDiffsRefresh,
    refreshFiles: files.refreshFiles,
    syncRuntimeMetadataForSession,
    onBackgroundSessionIdle: markSessionCompleted,
  });
  const {
    store,
    isLoadingMessages,
    refreshMessages,
    updateMessages,
    removeSessionEntries,
    getStore,
    commitStore,
  } = eventBus;

  const messages = store.messages[activeSessionId ?? ""] ?? EMPTY_WORKSPACE_MESSAGES;

  const sessions = useMemo(
    () =>
      listedSessions.map((session) =>
        overlaySessionRuntimeStatus(session, store.sessionStatus[session.id]),
      ),
    [listedSessions, store.sessionStatus],
  );

  // Visible pending permissions: the active session plus its known children
  // (session.parentId → active). The bus store is the single source; no
  // permission cards are grafted into message parts.
  const permissions = useMemo(
    () => selectVisiblePermissions(store.permissions, sessions, activeSessionId),
    [activeSessionId, sessions, store.permissions],
  );

  const { createSession, deleteSession } = useWorkspaceSessionActions({
    createWorkspaceSession,
    deleteWorkspaceSession,
    clearSessionSelectionState,
    initializeSessionSelectionState,
    sessionSelectionStateRef,
    updateSessionMessages: updateMessages,
    removeSessionEntries,
  });

  const [isStartingNewSession, setIsStartingNewSession] = useState(false);

  const { sendMessage, answerPermission, abortSession } =
    useWorkspaceMessageActions({
      slug,
      activeSessionIdRef,
      agentDefaultModel,
      createSession,
      models,
      primaryAgentId,
      sessionSelectionStateRef,
      getStore,
      commitStore,
      onStartingNewSessionChange: setIsStartingNewSession,
    });

  const derived = useWorkspaceDerivedState({
    sessions,
    activeSessionId,
    sessionSelectionState,
    primaryAgentId,
    agentDefaultModel,
    models,
  });

  useWorkspaceInitialRefreshEffect({
    enabled,
    isConnected,
    refreshFiles: files.refreshFiles,
    loadSessions,
    loadModels,
    loadAgentCatalog,
    refreshDiffs,
  });
  useWorkspaceActiveSessionEffects({
    activeSessionId,
    enabled,
    isConnected,
    ensureSessionFamilyLoaded,
    refreshMessages,
  });
  useWorkspaceConfigRefreshEffect({
    enabled,
    isConnected,
    loadAgentCatalog,
    loadModels,
  });
  useWorkspacePollingEffect({
    enabled,
    isConnected,
    loadSessions,
    pollInterval,
  });
  useWorkspaceFlowSeenEffect({
    activeSession: derived.activeSession,
    markFlowRunSeen,
  });

  return {
    connection,
    isConnected,
    fileTree: files.fileTree,
    isLoadingFiles: files.isLoadingFiles,
    refreshFiles: files.refreshFiles,
    readFile: files.readFile,
    writeFile: files.writeFile,
    deleteFile: files.deleteFile,
    applyPatch: files.applyPatch,
    discardFileChanges: files.discardFileChanges,
    sessions,
    activeSessionId: sessionsHook.activeSessionId,
    activeSession: derived.activeSession,
    isLoadingSessions: sessionsHook.isLoadingSessions,
    isInitialSessionsReady: sessionsHook.isInitialSessionsReady,
    sessionsError: sessionsHook.sessionsError,
    isLoadingMoreSessions: sessionsHook.isLoadingMoreSessions,
    hasMoreSessions: sessionsHook.hasMoreSessions,
    unseenCompletedSessions: sessionsHook.unseenCompletedSessions,
    refreshSessions: sessionsHook.loadSessions,
    loadMoreSessions: sessionsHook.loadMoreSessions,
    selectSession: sessionsHook.selectSession,
    markFlowRunSeen: sessionsHook.markFlowRunSeen,
    createSession,
    deleteSession,
    renameSession: sessionsHook.renameSession,
    messages,
    isLoadingMessages,
    isSending: isSessionSending(store, activeSessionId ?? ""),
    isStartingNewSession,
    sendMessage,
    answerPermission,
    abortSession,
    refreshMessages,
    permissions,
    diffs: diffsHook.diffs,
    isLoadingDiffs: diffsHook.isLoadingDiffs,
    diffsError: diffsHook.diffsError,
    refreshDiffs,
    models: modelSelectionHook.models,
    agentDefaultModel: modelSelectionHook.agentDefaultModel,
    selectedModel: derived.selectedModel,
    hasManualModelSelection: derived.hasManualModelSelection,
    setSelectedModel: modelSelectionHook.setSelectedModel,
    agentCatalog: modelSelectionHook.agentCatalog,
  };
}

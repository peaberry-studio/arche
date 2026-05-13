"use client";

import { useCallback } from "react";

import type { WorkspaceMessage } from "@/lib/opencode/types";
import { useInstanceHeartbeat } from "@/hooks/use-instance-heartbeat";
import { useWorkspaceConnection } from "@/hooks/use-workspace-connection";
import { useWorkspaceDiffs } from "@/hooks/use-workspace-diffs";
import { useWorkspaceFiles } from "@/hooks/use-workspace-files";
import { useWorkspaceDerivedState } from "@/hooks/workspace/use-workspace-derived-state";
import {
  useWorkspaceActiveSessionEffects,
  useWorkspaceAutopilotSeenEffect,
  useWorkspaceCleanupEffect,
  useWorkspaceConfigRefreshEffect,
  useWorkspaceInitialRefreshEffect,
  useWorkspacePollingEffect,
  useWorkspaceResumeEffect,
} from "@/hooks/workspace/use-workspace-effects";
import { useWorkspaceMessageActions } from "@/hooks/workspace/use-workspace-message-actions";
import { useWorkspaceMessages } from "@/hooks/workspace/use-workspace-messages";
import { useWorkspaceModelSelection } from "@/hooks/workspace/use-workspace-model-selection";
import { useWorkspaceSessionActions } from "@/hooks/workspace/use-workspace-session-actions";
import { useWorkspaceSessions } from "@/hooks/workspace/use-workspace-sessions";
import { useWorkspaceStreaming } from "@/hooks/workspace/use-workspace-streaming";
import {
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
  useInstanceHeartbeat(slug, enabled && reaperEnabled);

  // Sessions
  const sessionsHook = useWorkspaceSessions({
    slug,
    storageScope,
    initialSessionId,
    isConnected: enabled && isConnected,
  });

  const getActiveSessionId = useCallback(
    () => sessionsHook.activeSessionIdRef.current,
    [sessionsHook.activeSessionIdRef]
  );
  const getSessions = useCallback(
    () => sessionsHook.sessionsRef.current,
    [sessionsHook.sessionsRef]
  );

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
    syncActiveAgentFromRuntime,
    syncRuntimeMetadataForSession,
    syncRuntimeSelectedModel,
  } = modelSelectionHook;

  const handleMessagesHydrated = useCallback(
    (sessionId: string, hydratedMessages: WorkspaceMessage[]) => {
      syncRuntimeMetadataForSession(sessionId, hydratedMessages);
    },
    [syncRuntimeMetadataForSession]
  );

  // Messages
  const messagesHook = useWorkspaceMessages({
    slug,
    getActiveSessionId,
    onHydrated: handleMessagesHydrated,
  });

  // Streaming
  const streamingHook = useWorkspaceStreaming({
    slug,
    updateSessionMessages: messagesHook.updateSessionMessages,
    syncRuntimeSelectedModel,
    syncActiveAgentFromRuntime,
    syncRuntimeMetadataForSession,
    refreshDiffs: diffsHook.triggerDiffsRefresh,
    refreshFiles: files.refreshFiles,
    getActiveSessionId,
    getSessions,
    onBackgroundStreamCompleted: sessionsHook.markSessionCompleted,
    resumeFailureStateRef: messagesHook.resumeFailureStateRef,
  });

  const {
    activeSessionId,
    activeSessionIdRef,
    createSession: createWorkspaceSession,
    deleteSession: deleteWorkspaceSession,
    ensureSessionFamilyLoaded,
    loadSessions,
    markAutopilotRunSeen,
    sessions,
    sessionsRef,
  } = sessionsHook;
  const {
    messages,
    refreshMessages: refreshWorkspaceMessages,
    removeSessions,
    resumeFailureStateRef,
    updateSessionMessages,
  } = messagesHook;
  const {
    abortAllStreams,
    abortSessionStream,
    activeStreamsRef,
    isMountedRef,
    resetSessions,
    sessionStreamStatus,
    sessionStreamStatusRef,
    setIsStartingNewSession,
    streamChat,
    workspaceRefreshTimeoutRef,
  } = streamingHook;
  const { refreshDiffs } = diffsHook;

  const { createSession, deleteSession } = useWorkspaceSessionActions({
    createWorkspaceSession,
    deleteWorkspaceSession,
    resetSessions,
    clearSessionSelectionState,
    initializeSessionSelectionState,
    removeSessions,
    sessionSelectionStateRef,
    updateSessionMessages,
  });

  const {
    activeSession,
    enrichedSessions,
    hasManualModelSelection,
    isSending,
    selectedModel,
  } = useWorkspaceDerivedState({
    sessions,
    activeSessionId,
    sessionStreamStatus,
    sessionSelectionState,
    primaryAgentId,
    agentDefaultModel,
    models,
  });

  const { abortSession, answerPermission, refreshMessages, sendMessage } =
    useWorkspaceMessageActions({
      slug,
      activeSessionIdRef,
      activeStreamsRef,
      agentDefaultModel,
      createSession,
      models,
      primaryAgentId,
      refreshWorkspaceMessages,
      sessionSelectionStateRef,
      sessionStreamStatusRef,
      setIsStartingNewSession,
      streamChat,
      abortSessionStream,
      updateSessionMessages,
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
  useWorkspaceResumeEffect({
    activeSession,
    activeSessionId,
    activeStreamsRef,
    enabled,
    isConnected,
    messages,
    resumeFailureStateRef,
    sessionStreamStatusRef,
    slug,
    streamChat,
    updateSessionMessages,
  });
  useWorkspacePollingEffect({
    activeSessionIdRef,
    enabled,
    isConnected,
    loadSessions,
    pollInterval,
    refreshDiffs,
    refreshMessages,
    sessionsRef,
  });
  useWorkspaceCleanupEffect({
    abortAllStreams,
    isMountedRef,
    workspaceRefreshTimeoutRef,
  });
  useWorkspaceAutopilotSeenEffect({
    activeSession,
    markAutopilotRunSeen,
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
    sessions: enrichedSessions,
    activeSessionId: sessionsHook.activeSessionId,
    activeSession,
    isLoadingSessions: sessionsHook.isLoadingSessions,
    isLoadingMoreSessions: sessionsHook.isLoadingMoreSessions,
    hasMoreSessions: sessionsHook.hasMoreSessions,
    unseenCompletedSessions: sessionsHook.unseenCompletedSessions,
    refreshSessions: sessionsHook.loadSessions,
    loadMoreSessions: sessionsHook.loadMoreSessions,
    selectSession: sessionsHook.selectSession,
    markAutopilotRunSeen: sessionsHook.markAutopilotRunSeen,
    createSession,
    deleteSession,
    renameSession: sessionsHook.renameSession,
    messages: messagesHook.messages,
    isLoadingMessages: messagesHook.isLoadingMessages,
    isSending,
    isStartingNewSession: streamingHook.isStartingNewSession,
    sendMessage,
    answerPermission,
    abortSession,
    refreshMessages,
    diffs: diffsHook.diffs,
    isLoadingDiffs: diffsHook.isLoadingDiffs,
    diffsError: diffsHook.diffsError,
    refreshDiffs: diffsHook.refreshDiffs,
    models: modelSelectionHook.models,
    agentDefaultModel: modelSelectionHook.agentDefaultModel,
    selectedModel,
    hasManualModelSelection,
    setSelectedModel: modelSelectionHook.setSelectedModel,
    agentCatalog: modelSelectionHook.agentCatalog,
  };
}

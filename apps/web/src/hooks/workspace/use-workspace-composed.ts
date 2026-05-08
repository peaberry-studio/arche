"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { abortSessionAction } from "@/actions/opencode";
import type {
  MessagePart,
  PermissionResponse,
  WorkspaceMessage,
} from "@/lib/opencode/types";
import { WORKSPACE_CONFIG_STATUS_CHANGED_EVENT } from "@/lib/runtime/config-status-events";
import { canAutoResume } from "@/lib/workspace-resume-policy";
import { useInstanceHeartbeat } from "@/hooks/use-instance-heartbeat";
import { useWorkspaceConnection } from "@/hooks/use-workspace-connection";
import { useWorkspaceDiffs } from "@/hooks/use-workspace-diffs";
import { useWorkspaceFiles } from "@/hooks/use-workspace-files";
import { useWorkspaceMessages } from "@/hooks/workspace/use-workspace-messages";
import { useWorkspaceModelSelection } from "@/hooks/workspace/use-workspace-model-selection";
import { useWorkspaceSessions } from "@/hooks/workspace/use-workspace-sessions";
import { useWorkspaceStreaming } from "@/hooks/workspace/use-workspace-streaming";
import {
  getSessionSelectionKey,
  PRE_SESSION_SELECTION_KEY,
  STALE_PENDING_ASSISTANT_MS,
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
  const onConnectedRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const cleanupDeletedSessionsRef = useRef<(sessionIds: Set<string>) => void>(() => undefined);

  const { connection, isConnected } = useWorkspaceConnection(
    slug,
    enabled,
    () => onConnectedRef.current(),
  );

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
    onSessionDeleted: (sessionIds) => cleanupDeletedSessionsRef.current(sessionIds),
  });

  // Stable getter refs to avoid recreating sub-hook callbacks on every render
  const getActiveSessionIdRef = useRef(() => sessionsHook.activeSessionIdRef.current);
  getActiveSessionIdRef.current = () => sessionsHook.activeSessionIdRef.current;

  const getSessionsRef = useRef(() => sessionsHook.sessionsRef.current);
  getSessionsRef.current = () => sessionsHook.sessionsRef.current;

  const getActiveSessionId = useCallback(
    () => getActiveSessionIdRef.current(),
    []
  );
  const getSessions = useCallback(
    () => getSessionsRef.current(),
    []
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

  cleanupDeletedSessionsRef.current = (sessionIds) => {
    resetSessions(sessionIds);
    for (const sessionId of sessionIds) {
      clearSessionSelectionState(sessionId);
    }
    removeSessions(sessionIds);
  };

  // Merge local streaming knowledge into sessions so UI indicators (green dot)
  // reflect real-time streaming state, not just the polled API status.
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

  const activeSession = enrichedSessions.find((s) => s.id === activeSessionId) ?? null;

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

  // --- Cross-cutting orchestration ---

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
      return deleteWorkspaceSession(id);
    },
    [deleteWorkspaceSession]
  );

  const refreshMessages = useCallback(async (sessionIdOverride?: string) => {
    const targetSessionId = sessionIdOverride ?? activeSessionIdRef.current;
    if (!targetSessionId) return;

    const targetStatus = sessionStreamStatusRef.current[targetSessionId];
    if (
      targetStatus === "submitted" || targetStatus === "streaming" ||
      activeStreamsRef.current.has(targetSessionId)
    ) {
      return;
    }

    await refreshWorkspaceMessages(sessionIdOverride);
  }, [
    activeSessionIdRef,
    activeStreamsRef,
    refreshWorkspaceMessages,
    sessionStreamStatusRef,
  ]);

  const sendMessage = useCallback(
    async (
      text: string,
      model?: { providerId: string; modelId: string },
      options?: {
        forceNewSession?: boolean;
        attachments?: { path: string; filename?: string; mime?: string }[];
        contextPaths?: string[];
      }
    ) => {
      const targetSessionId = activeSessionIdRef.current;

      const messageAttachments = (options?.attachments ?? []).filter(
        (attachment) =>
          typeof attachment.path === "string" &&
          attachment.path.trim().length > 0
      );
      const messageContextPaths = Array.from(
        new Set(
          (options?.contextPaths ?? [])
            .filter((path): path is string => typeof path === "string")
            .map((path) => path.trim())
            .filter((path) => path.length > 0)
        )
      );

      const forceNewSession = options?.forceNewSession === true;
      if (forceNewSession) {
        setIsStartingNewSession(true);
      }

      let sessionId = targetSessionId;
      if (forceNewSession || !sessionId) {
        try {
          const newSession = await createSession();
          sessionId = newSession?.id ?? null;
        } finally {
          if (forceNewSession) {
            setIsStartingNewSession(false);
          }
        }
      }

      if (!sessionId) return false;

      const currentStatus = sessionStreamStatusRef.current[sessionId];
      if (currentStatus === "submitted" || currentStatus === "streaming") {
        return false;
      }

      let resolvedModel = model;
      if (!resolvedModel) {
        const selection =
          sessionSelectionStateRef.current[sessionId] ??
          sessionSelectionStateRef.current[PRE_SESSION_SELECTION_KEY] ??
          { manualModel: null, runtimeModel: null, activeAgentId: primaryAgentId };

        const fallbackModel =
          selection.manualModel ??
          selection.runtimeModel ??
          agentDefaultModel ??
          models[0] ??
          null;

        if (fallbackModel) {
          resolvedModel = {
            providerId: fallbackModel.providerId,
            modelId: fallbackModel.modelId,
          };
        }
      }

      // Add optimistic user message
      const tempUserMsgId = `temp-user-${Date.now()}`;
      const tempUserParts: MessagePart[] = [
        { type: "text", text },
        ...messageAttachments.map((attachment) => ({
          type: "file" as const,
          path: attachment.path,
          filename: attachment.filename,
          mime: attachment.mime,
        })),
      ];
      const tempUserMsg: WorkspaceMessage = {
        id: tempUserMsgId,
        sessionId: sessionId,
        role: "user",
        content: text,
        timestamp: "Just now",
        parts: tempUserParts,
        pending: false,
      };

      // Add placeholder assistant message with "connecting" status
      const tempAssistantMsgId = `temp-assistant-${Date.now()}`;
      const tempAssistantMsg: WorkspaceMessage = {
        id: tempAssistantMsgId,
        sessionId: sessionId,
        role: "assistant",
        content: "",
        timestamp: "Just now",
        timestampRaw: Date.now(),
        parts: [],
        pending: true,
        statusInfo: { status: "thinking" },
      };

      updateSessionMessages(sessionId, (prev) => [...prev, tempUserMsg, tempAssistantMsg]);
      void streamChat({
        sessionId,
        mode: "send",
        targetMessageId: tempAssistantMsgId,
        text,
        model: resolvedModel,
        attachments: messageAttachments,
        contextPaths: messageContextPaths,
      });
      return true;
    },
    [
      createSession,
      activeSessionIdRef,
      agentDefaultModel,
      models,
      primaryAgentId,
      sessionSelectionStateRef,
      sessionStreamStatusRef,
      setIsStartingNewSession,
      streamChat,
      updateSessionMessages,
    ]
  );

  const answerPermission = useCallback(
    async (
      permissionSessionId: string,
      permissionId: string,
      response: PermissionResponse
    ) => {
      try {
        const reply = await fetch(
          `/api/w/${slug}/chat/permissions/${encodeURIComponent(permissionId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: permissionSessionId, response }),
          }
        );

        if (!reply.ok) return false;

        updateSessionMessages(permissionSessionId, (prev) =>
          prev.map((message) => ({
            ...message,
            parts: message.parts.map((part) =>
              part.type === "permission" && part.permissionId === permissionId
                ? { ...part, state: response === "reject" ? "rejected" : "approved" }
                : part
            ),
          }))
        );

        return true;
      } catch {
        return false;
      }
    },
    [slug, updateSessionMessages]
  );

  const abortSession = useCallback(async () => {
    const currentActiveSessionId = activeSessionIdRef.current;
    if (!currentActiveSessionId) return;
    updateSessionMessages(currentActiveSessionId, (prev) =>
      prev.map((message) => {
        if (message.role !== "assistant" || !message.pending) return message;

        return {
          ...message,
          pending: false,
          statusInfo: { status: "error", detail: "cancelled" },
        };
      })
    );
    abortSessionStream(currentActiveSessionId);
    await abortSessionAction(slug, currentActiveSessionId);
  }, [abortSessionStream, activeSessionIdRef, slug, updateSessionMessages]);

  // Wire the real init callback now that all functions are defined.
  onConnectedRef.current = async () => {
    await Promise.all([
      files.refreshFiles(),
      loadSessions(),
      loadModels(),
      loadAgentCatalog(),
      refreshDiffs({ force: true }),
    ]);
  };

  // --- Effects ---

  // Load messages when active session changes
  useEffect(() => {
    if (activeSessionId && enabled && isConnected) {
      refreshMessages(activeSessionId);
    }
  }, [activeSessionId, enabled, isConnected, refreshMessages]);

  useEffect(() => {
    if (!activeSessionId || !enabled || !isConnected) return;
    void ensureSessionFamilyLoaded(activeSessionId);
  }, [activeSessionId, ensureSessionFamilyLoaded, enabled, isConnected]);

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

  // Derive a stable fingerprint of pending assistant messages so the resume
  // effect only re-runs when the *set* of pending IDs changes — not on every
  // content/part update that occurs during active streaming.
  const pendingAssistantKey = useMemo(() => {
    const pending: string[] = [];
    for (const m of messages) {
      if (m.role === "assistant" && m.pending) {
        pending.push(m.id);
      }
    }
    return pending.join(",");
  }, [messages]);

  // Keep a ref to messages so the resume effect can read the latest list
  // without re-subscribing on every content change.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Auto-resume pending assistant messages
  useEffect(() => {
    if (!activeSessionId || !enabled || !isConnected) return;
    const resumeStatus = sessionStreamStatusRef.current[activeSessionId];
    if (resumeStatus === "submitted" || resumeStatus === "streaming") return;

    const existingStream = activeStreamsRef.current.get(activeSessionId);
    if (existingStream) {
      return;
    }

    const currentMessages = messagesRef.current;
    const now = Date.now();
    const sessionBusy = activeSession?.status === "busy";

    const stalePendingWithoutParts = [...currentMessages].reverse().find((m) => {
      if (m.role !== "assistant" || !m.pending) return false;
      if (m.parts.length > 0) return false;
      if (typeof m.timestampRaw !== "number") return false;
      return now - m.timestampRaw >= STALE_PENDING_ASSISTANT_MS;
    });

    if (stalePendingWithoutParts && !sessionBusy) {
      updateSessionMessages(activeSessionId, (prev) =>
        prev.map((m) => {
          if (m.id !== stalePendingWithoutParts.id) return m;
          return {
            ...m,
            pending: false,
            statusInfo: { status: "error", detail: "stream_incomplete" },
          };
        })
      );
      return;
    }

    const pendingAssistant = [...currentMessages]
      .reverse()
      .find((m) => {
        if (m.role !== "assistant" || !m.pending) return false;

        const resumeState = resumeFailureStateRef.current.get(m.id);
        const allowed = canAutoResume(resumeState, now);

        if (allowed && resumeState?.suppressed) {
          resumeFailureStateRef.current.delete(m.id);
        }

        return allowed;
      });
    if (pendingAssistant) {
      if (!sessionBusy && pendingAssistant.parts.length === 0) {
        return;
      }

      streamChat({
        sessionId: activeSessionId,
        mode: "resume",
        targetMessageId: pendingAssistant.id,
      });
    }
  }, [
    activeSession?.status,
    activeSessionId,
    enabled,
    isConnected,
    pendingAssistantKey,
    activeStreamsRef,
    resumeFailureStateRef,
    sessionStreamStatusRef,
    streamChat,
    updateSessionMessages,
  ]);

  // Poll for session status updates
  useEffect(() => {
    if (!enabled || !isConnected || pollInterval <= 0) return;

    const interval = setInterval(() => {
      loadSessions();

      const currentSessions = sessionsRef.current;
      const currentActiveSessionId = activeSessionIdRef.current;
      const hasBusySessions = currentSessions.some(
        (session) => session.status === "busy",
      );

      if (hasBusySessions) {
        refreshDiffs();
      }

      const sessionIdsToRefresh = new Set<string>();
      currentSessions.forEach((session) => {
        if (session.status === "busy") {
          sessionIdsToRefresh.add(session.id);
        }
      });
      if (
        currentActiveSessionId &&
        currentSessions.some(
          (s) => s.id === currentActiveSessionId && s.status === "busy",
        )
      ) {
        sessionIdsToRefresh.add(currentActiveSessionId);
      }

      sessionIdsToRefresh.forEach((sessionId) => {
        void refreshMessages(sessionId);
      });
    }, pollInterval);

    return () => clearInterval(interval);
  }, [
    isConnected,
    enabled,
    loadSessions,
    pollInterval,
    refreshDiffs,
    refreshMessages,
    sessionsRef,
    activeSessionIdRef,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (workspaceRefreshTimeoutRef.current) {
        clearTimeout(workspaceRefreshTimeoutRef.current);
        workspaceRefreshTimeoutRef.current = null;
      }
      abortAllStreams();
    };
  }, [
    abortAllStreams,
    isMountedRef,
    workspaceRefreshTimeoutRef,
  ]);

  // Auto-mark autopilot run seen
  const autoMarkedAutopilotRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    const runId = activeSession?.autopilot?.hasUnseenResult
      ? activeSession.autopilot.runId
      : null;
    if (!runId) {
      return;
    }
    if (autoMarkedAutopilotRunIdRef.current === runId) {
      return;
    }

    autoMarkedAutopilotRunIdRef.current = runId;
    void markAutopilotRunSeen(runId);
  }, [activeSession, markAutopilotRunSeen]);

  const isSending = useMemo(() => {
    if (!activeSessionId) return false;
    const status = sessionStreamStatus[activeSessionId];
    return status === "submitted" || status === "streaming";
  }, [activeSessionId, sessionStreamStatus]);

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

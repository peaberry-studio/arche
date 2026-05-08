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
    isConnected,
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

  const handleMessagesHydrated = useCallback(
    (sessionId: string, hydratedMessages: WorkspaceMessage[]) => {
      modelSelectionHook.syncRuntimeMetadataForSession(sessionId, hydratedMessages);
    },
    [modelSelectionHook.syncRuntimeMetadataForSession]
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
    syncRuntimeSelectedModel: modelSelectionHook.syncRuntimeSelectedModel,
    syncActiveAgentFromRuntime: modelSelectionHook.syncActiveAgentFromRuntime,
    syncRuntimeMetadataForSession: modelSelectionHook.syncRuntimeMetadataForSession,
    refreshDiffs: diffsHook.triggerDiffsRefresh,
    refreshFiles: files.refreshFiles,
    getActiveSessionId,
    getSessions,
    resumeFailureStateRef: messagesHook.resumeFailureStateRef,
  });

  // Merge local streaming knowledge into sessions so UI indicators (green dot)
  // reflect real-time streaming state, not just the polled API status.
  const enrichedSessions = useMemo(() => {
    const sessionStreamStatus = streamingHook.sessionStreamStatus;
    const hasStreaming = Object.keys(sessionStreamStatus).length > 0;
    if (!hasStreaming) return sessionsHook.sessions;
    return sessionsHook.sessions.map((session) => {
      const streamStatus = sessionStreamStatus[session.id];
      if (
        (streamStatus === "submitted" || streamStatus === "streaming") &&
        session.status !== "busy"
      ) {
        return { ...session, status: "busy" as const };
      }
      return session;
    });
  }, [sessionsHook.sessions, streamingHook.sessionStreamStatus]);

  const activeSession = enrichedSessions.find((s) => s.id === sessionsHook.activeSessionId) ?? null;

  const currentSessionSelection =
    modelSelectionHook.sessionSelectionState[getSessionSelectionKey(sessionsHook.activeSessionId)] ??
    { manualModel: null, runtimeModel: null, activeAgentId: modelSelectionHook.primaryAgentId };

  const selectedModel =
    currentSessionSelection.manualModel ??
    currentSessionSelection.runtimeModel ??
    modelSelectionHook.agentDefaultModel ??
    modelSelectionHook.models[0] ??
    null;

  const hasManualModelSelection = currentSessionSelection.manualModel !== null;

  // --- Cross-cutting orchestration ---

  const createSession = useCallback(
    async (title?: string) => {
      const result = await sessionsHook.createSession(title);
      if (result) {
        const draftSelection = modelSelectionHook.sessionSelectionStateRef.current[PRE_SESSION_SELECTION_KEY];
        messagesHook.updateSessionMessages(result.id, []);
        modelSelectionHook.initializeSessionSelectionState(result.id, draftSelection);
        if (draftSelection) {
          modelSelectionHook.clearSessionSelectionState(PRE_SESSION_SELECTION_KEY);
        }
      }
      return result;
    },
    [
      sessionsHook.createSession,
      messagesHook.updateSessionMessages,
      modelSelectionHook.initializeSessionSelectionState,
      modelSelectionHook.clearSessionSelectionState,
      modelSelectionHook.sessionSelectionStateRef,
    ]
  );

  const deleteSession = useCallback(
    async (id: string) => {
      const result = await sessionsHook.deleteSession(id);
      if (result) {
        const sessionIdsToRemove = new Set<string>();
        // Collect all descendants from current sessions state
        const allSessions = sessionsHook.sessionsRef.current;
        const familyIds = new Set<string>([id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const session of allSessions) {
            if (
              session.parentId &&
              familyIds.has(session.parentId) &&
              !familyIds.has(session.id)
            ) {
              familyIds.add(session.id);
              changed = true;
            }
          }
        }
        familyIds.forEach((sid) => sessionIdsToRemove.add(sid));

        sessionIdsToRemove.forEach((sessionId) => {
          streamingHook.abortSessionStream(sessionId);
          streamingHook.setSessionStreamStatusTo(sessionId, "ready");
          modelSelectionHook.clearSessionSelectionState(sessionId);
          messagesHook.resumeFailureStateRef.current.delete(sessionId);
        });

        messagesHook.setMessagesBySession((prev) => {
          const next = { ...prev };
          let changed = false;
          sessionIdsToRemove.forEach((sessionId) => {
            if (!(sessionId in next)) return;
            delete next[sessionId];
            changed = true;
          });
          return changed ? next : prev;
        });
        messagesHook.setLoadingMessageSessionIds((prev) =>
          prev.filter((sessionId) => !sessionIdsToRemove.has(sessionId))
        );
      }
      return result;
    },
    [
      sessionsHook.deleteSession,
      sessionsHook.sessionsRef,
      streamingHook.abortSessionStream,
      streamingHook.setSessionStreamStatusTo,
      modelSelectionHook.clearSessionSelectionState,
      messagesHook.setMessagesBySession,
      messagesHook.setLoadingMessageSessionIds,
      messagesHook.resumeFailureStateRef,
    ]
  );

  const refreshMessages = useCallback(async (sessionIdOverride?: string) => {
    const targetSessionId = sessionIdOverride ?? sessionsHook.activeSessionIdRef.current;
    if (!targetSessionId) return;

    const targetStatus = streamingHook.sessionStreamStatusRef.current[targetSessionId];
    if (
      targetStatus === "submitted" || targetStatus === "streaming" ||
      streamingHook.activeStreamsRef.current.has(targetSessionId)
    ) {
      console.log(
        "[useWorkspace] refreshMessages: skipping, active stream in progress"
      );
      return;
    }

    await messagesHook.refreshMessages(sessionIdOverride);
  }, [
    sessionsHook.activeSessionIdRef,
    streamingHook.sessionStreamStatusRef,
    streamingHook.activeStreamsRef,
    messagesHook.refreshMessages,
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
      console.log("[useWorkspace] sendMessage called", {
        text,
        model,
        activeSessionId: sessionsHook.activeSessionIdRef.current,
        options,
      });

      const targetSessionId = sessionsHook.activeSessionIdRef.current;

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
        streamingHook.setIsStartingNewSession(true);
      }

      let sessionId = targetSessionId;
      if (forceNewSession || !sessionId) {
        try {
          const newSession = await createSession();
          sessionId = newSession?.id ?? null;
        } finally {
          if (forceNewSession) {
            streamingHook.setIsStartingNewSession(false);
          }
        }
      }

      if (!sessionId) return false;

      const currentStatus = streamingHook.sessionStreamStatusRef.current[sessionId];
      if (currentStatus === "submitted" || currentStatus === "streaming") {
        return false;
      }

      let resolvedModel = model;
      if (!resolvedModel) {
        const selection =
          modelSelectionHook.sessionSelectionStateRef.current[sessionId] ??
          modelSelectionHook.sessionSelectionStateRef.current[PRE_SESSION_SELECTION_KEY] ??
          { manualModel: null, runtimeModel: null, activeAgentId: modelSelectionHook.primaryAgentId };

        const fallbackModel =
          selection.manualModel ??
          selection.runtimeModel ??
          modelSelectionHook.agentDefaultModel ??
          modelSelectionHook.models[0] ??
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

      messagesHook.updateSessionMessages(sessionId, (prev) => [...prev, tempUserMsg, tempAssistantMsg]);
      void streamingHook.streamChat({
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
      modelSelectionHook.agentDefaultModel,
      modelSelectionHook.models,
      modelSelectionHook.primaryAgentId,
      modelSelectionHook.sessionSelectionStateRef,
      sessionsHook.activeSessionIdRef,
      streamingHook,
      messagesHook.updateSessionMessages,
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

        messagesHook.updateSessionMessages(permissionSessionId, (prev) =>
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
    [slug, messagesHook.updateSessionMessages]
  );

  const abortSession = useCallback(async () => {
    const activeSessionId = sessionsHook.activeSessionIdRef.current;
    if (!activeSessionId) return;
    messagesHook.updateSessionMessages(activeSessionId, (prev) =>
      prev.map((message) => {
        if (message.role !== "assistant" || !message.pending) return message;

        return {
          ...message,
          pending: false,
          statusInfo: { status: "error", detail: "cancelled" },
        };
      })
    );
    streamingHook.abortSessionStream(activeSessionId);
    await abortSessionAction(slug, activeSessionId);
  }, [streamingHook.abortSessionStream, sessionsHook.activeSessionIdRef, slug, messagesHook.updateSessionMessages]);

  // Wire the real init callback now that all functions are defined.
  onConnectedRef.current = async () => {
    await Promise.all([
      files.refreshFiles(),
      sessionsHook.loadSessions(),
      modelSelectionHook.loadModels(),
      modelSelectionHook.loadAgentCatalog(),
      diffsHook.refreshDiffs({ force: true }),
    ]);
  };

  // --- Effects ---

  // Load messages when active session changes
  useEffect(() => {
    console.log(
      "[useWorkspace] activeSessionId changed:",
      sessionsHook.activeSessionId,
      "isConnected:",
      isConnected
    );
    if (sessionsHook.activeSessionId && isConnected) {
      refreshMessages(sessionsHook.activeSessionId);
    }
  }, [sessionsHook.activeSessionId, isConnected, refreshMessages]);

  useEffect(() => {
    if (!sessionsHook.activeSessionId || !isConnected) return;
    void sessionsHook.ensureSessionFamilyLoaded(sessionsHook.activeSessionId);
  }, [sessionsHook.activeSessionId, sessionsHook.ensureSessionFamilyLoaded, isConnected]);

  useEffect(() => {
    if (!enabled || !isConnected) return;

    const handleWorkspaceConfigChanged = () => {
      void modelSelectionHook.loadModels();
      void modelSelectionHook.loadAgentCatalog();
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
  }, [enabled, isConnected, modelSelectionHook.loadAgentCatalog, modelSelectionHook.loadModels]);

  // Derive a stable fingerprint of pending assistant messages so the resume
  // effect only re-runs when the *set* of pending IDs changes — not on every
  // content/part update that occurs during active streaming.
  const pendingAssistantKey = useMemo(() => {
    const pending: string[] = [];
    for (const m of messagesHook.messages) {
      if (m.role === "assistant" && m.pending) {
        pending.push(m.id);
      }
    }
    return pending.join(",");
  }, [messagesHook.messages]);

  // Keep a ref to messages so the resume effect can read the latest list
  // without re-subscribing on every content change.
  const messagesRef = useRef(messagesHook.messages);
  messagesRef.current = messagesHook.messages;

  // Auto-resume pending assistant messages
  useEffect(() => {
    if (!sessionsHook.activeSessionId || !isConnected) return;
    const resumeStatus = streamingHook.sessionStreamStatusRef.current[sessionsHook.activeSessionId];
    if (resumeStatus === "submitted" || resumeStatus === "streaming") return;

    const existingStream = streamingHook.activeStreamsRef.current.get(sessionsHook.activeSessionId);
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
      return now - m.timestampRaw >= 5000;
    });

    if (stalePendingWithoutParts && !sessionBusy) {
      messagesHook.updateSessionMessages(sessionsHook.activeSessionId, (prev) =>
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

        const resumeState = messagesHook.resumeFailureStateRef.current.get(m.id);
        const allowed = canAutoResume(resumeState, now);

        if (allowed && resumeState?.suppressed) {
          messagesHook.resumeFailureStateRef.current.delete(m.id);
        }

        return allowed;
      });
    if (pendingAssistant) {
      if (!sessionBusy && pendingAssistant.parts.length === 0) {
        return;
      }

      streamingHook.streamChat({
        sessionId: sessionsHook.activeSessionId,
        mode: "resume",
        targetMessageId: pendingAssistant.id,
      });
    }
  }, [
    activeSession?.status,
    sessionsHook.activeSessionId,
    isConnected,
    pendingAssistantKey,
    streamingHook.streamChat,
    messagesHook.updateSessionMessages,
    streamingHook.sessionStreamStatusRef,
    streamingHook.activeStreamsRef,
    messagesHook.resumeFailureStateRef,
  ]);

  // Poll for session status updates
  useEffect(() => {
    if (!isConnected || pollInterval <= 0) return;

    const interval = setInterval(() => {
      sessionsHook.loadSessions();

      const currentSessions = sessionsHook.sessionsRef.current;
      const currentActiveSessionId = sessionsHook.activeSessionIdRef.current;
      const hasBusySessions = currentSessions.some(
        (session) => session.status === "busy",
      );

      if (hasBusySessions) {
        diffsHook.refreshDiffs();
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
    sessionsHook.loadSessions,
    pollInterval,
    diffsHook,
    refreshMessages,
    sessionsHook.sessionsRef,
    sessionsHook.activeSessionIdRef,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    streamingHook.isMountedRef.current = true;
    return () => {
      streamingHook.isMountedRef.current = false;
      if (streamingHook.workspaceRefreshTimeoutRef.current) {
        clearTimeout(streamingHook.workspaceRefreshTimeoutRef.current);
        streamingHook.workspaceRefreshTimeoutRef.current = null;
      }
      streamingHook.abortAllStreams();
    };
  }, [
    streamingHook.abortAllStreams,
    streamingHook.isMountedRef,
    streamingHook.workspaceRefreshTimeoutRef,
  ]);

  // Auto-mark autopilot run seen
  useEffect(() => {
    const runId = activeSession?.autopilot?.hasUnseenResult
      ? activeSession.autopilot.runId
      : null;
    if (!runId) {
      return;
    }

    void sessionsHook.markAutopilotRunSeen(runId);
  }, [activeSession, sessionsHook.markAutopilotRunSeen]);

  const isSending = useMemo(() => {
    const activeSessionId = sessionsHook.activeSessionId;
    if (!activeSessionId) return false;
    const status = streamingHook.sessionStreamStatus[activeSessionId];
    return status === "submitted" || status === "streaming";
  }, [streamingHook.sessionStreamStatus, sessionsHook.activeSessionId]);

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

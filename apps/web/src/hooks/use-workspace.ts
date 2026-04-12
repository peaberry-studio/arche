"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import {
  listSessionsAction,
  createSessionAction,
  deleteSessionAction,
  updateSessionAction,
  listMessagesAction,
  abortSessionAction,
  listModelsAction,
} from "@/actions/opencode";
import type {
  WorkspaceConnectionState,
  WorkspaceFileNode,
  WorkspaceSession,
  WorkspaceMessage,
  AvailableModel,
  MessageStatus,
  MessagePart,
} from "@/lib/opencode/types";
import { extractTextContent, transformParts } from "@/lib/opencode/transform";
import { isProviderId, normalizeProviderId } from "@/lib/providers/catalog";
import type { ProviderId } from "@/lib/providers/types";
import { INITIAL_SSE_PARSE_STATE, parseSseChunk } from "@/lib/sse-parser";
import {
  canAutoResume,
  recordResumeFailure,
  type ResumeFailureState,
} from "@/lib/workspace-resume-policy";
import { WORKSPACE_CONFIG_STATUS_CHANGED_EVENT } from "@/lib/runtime/config-status-events";
import { SerialJobExecutor } from "@/lib/serial-job-executor";
import { useInstanceHeartbeat } from "@/hooks/use-instance-heartbeat";
import { useWorkspaceConnection } from "@/hooks/use-workspace-connection";
import { useWorkspaceDiffs, type WorkspaceDiff } from "@/hooks/use-workspace-diffs";
import { useWorkspaceFiles } from "@/hooks/use-workspace-files";
import type { MessageAttachmentInput } from "@/types/workspace";

export type { WorkspaceDiff } from "@/hooks/use-workspace-diffs";

export type AgentCatalogItem = {
  id: string;
  displayName: string;
  model?: string;
  isPrimary: boolean;
};

type ProviderStatusEntry = {
  providerId: ProviderId;
  status: string;
};

const STALE_PENDING_ASSISTANT_MS = 5_000;
const RESUME_POLL_INTERVAL_MS = 4_000;
const EMPTY_WORKSPACE_MESSAGES: WorkspaceMessage[] = [];
const PRE_SESSION_SELECTION_KEY = "__pre_session__";

function areStatusInfoEqual(
  left: WorkspaceMessage["statusInfo"],
  right: WorkspaceMessage["statusInfo"]
): boolean {
  return (
    left?.status === right?.status &&
    left?.toolName === right?.toolName &&
    left?.detail === right?.detail
  );
}

function areModelsEqual(
  left: WorkspaceMessage["model"],
  right: WorkspaceMessage["model"]
): boolean {
  return (
    left?.providerId === right?.providerId &&
    left?.modelId === right?.modelId
  );
}

function arePartsEqual(left: MessagePart[], right: MessagePart[]): boolean {
  if (left.length !== right.length) return false;

  return left.every((part, index) => JSON.stringify(part) === JSON.stringify(right[index]));
}

function areMessagesEqual(left: WorkspaceMessage, right: WorkspaceMessage): boolean {
  return (
    left.id === right.id &&
    left.sessionId === right.sessionId &&
    left.role === right.role &&
    left.content === right.content &&
    left.timestamp === right.timestamp &&
    left.timestampRaw === right.timestampRaw &&
    left.pending === right.pending &&
    left.agentId === right.agentId &&
    areModelsEqual(left.model, right.model) &&
    areStatusInfoEqual(left.statusInfo, right.statusInfo) &&
    arePartsEqual(left.parts, right.parts)
  );
}

function areMessageListsEqual(left: WorkspaceMessage[], right: WorkspaceMessage[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((message, index) => areMessagesEqual(message, right[index]));
}

function extractPartDeltaText(delta: unknown): string | null {
  if (typeof delta === "string") {
    return delta;
  }

  if (!delta || typeof delta !== "object") {
    return null;
  }

  const maybeText = (delta as { text?: unknown }).text;
  return typeof maybeText === "string" ? maybeText : null;
}

function applyDeltaToPart(
  messageId: string,
  part: unknown,
  delta: unknown,
  textAccumulatorByPart: Map<string, string>
): unknown {
  if (!part || typeof part !== "object") {
    return part;
  }

  const partRecord = part as Record<string, unknown>;
  const partType = partRecord.type;
  if (partType !== "text" && partType !== "reasoning") {
    return part;
  }

  const partId =
    typeof partRecord.id === "string" && partRecord.id.trim().length > 0
      ? partRecord.id
      : `${String(partType)}:${messageId}`;
  const accumulatorKey = `${messageId}:${partId}`;
  const partText = typeof partRecord.text === "string" ? partRecord.text : "";

  if (partText.length > 0) {
    textAccumulatorByPart.set(accumulatorKey, partText);
    return {
      ...partRecord,
      id: partId,
    };
  }

  const deltaText = extractPartDeltaText(delta);
  if (!deltaText || deltaText.length === 0) {
    return {
      ...partRecord,
      id: partId,
    };
  }

  const nextText = `${textAccumulatorByPart.get(accumulatorKey) ?? ""}${deltaText}`;
  textAccumulatorByPart.set(accumulatorKey, nextText);

  return {
    ...partRecord,
    id: partId,
    text: nextText,
  };
}

export function filterModelsByProviderStatus(
  models: AvailableModel[],
  providerStatuses: ProviderStatusEntry[]
): AvailableModel[] {
  const enabledProviders = new Set(
    providerStatuses
      .filter((provider) => provider.status === "enabled")
      .map((provider) => normalizeProviderId(provider.providerId))
  );

  return models.filter((model) => {
    const normalizedProviderId = normalizeProviderId(model.providerId);
    if (!isProviderId(normalizedProviderId)) return true;
    if (normalizedProviderId === "opencode") return true;
    return enabledProviders.has(normalizedProviderId);
  });
}

function getActiveSessionStorageKey(scope: string): string {
  return `arche.workspace.${scope}.active-session`;
}

function readStoredValue(storage: Storage, key: string): string | null {
  const value = storage.getItem(key);
  return value && value.trim().length > 0 ? value : null;
}

function loadStoredActiveSessionId(key: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    return (
      readStoredValue(window.sessionStorage, key) ??
      readStoredValue(window.localStorage, key)
    );
  } catch {
    return null;
  }
}

function persistActiveSessionId(key: string, sessionId: string | null): void {
  if (typeof window === "undefined") return;

  try {
    if (sessionId) {
      window.sessionStorage.setItem(key, sessionId);
      window.localStorage.setItem(key, sessionId);
      return;
    }

    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage access errors.
  }
}

function normalizeAgentId(value: string): string {
  return value.trim().toLowerCase();
}

function findAgentInCatalog(
  catalog: AgentCatalogItem[],
  agentId: string
): AgentCatalogItem | undefined {
  const normalized = normalizeAgentId(agentId);
  return catalog.find((entry) => {
    if (entry.id === agentId) return true;
    return normalizeAgentId(entry.displayName) === normalized;
  });
}

function parseModelString(
  value?: string
): { providerId: string; modelId: string } | null {
  if (!value) return null;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator >= value.length - 1) return null;

  return {
    providerId: value.slice(0, separator),
    modelId: value.slice(separator + 1),
  };
}

function resolveModelEntry(
  providerId: string,
  modelId: string,
  models: AvailableModel[]
): AvailableModel {
  const normalizedProviderId = normalizeProviderId(providerId);
  const match = models.find(
    (entry) =>
      normalizeProviderId(entry.providerId) === normalizedProviderId &&
      entry.modelId === modelId
  );
  if (match) return match;

  return {
    providerId,
    modelId,
    providerName: providerId,
    modelName: modelId,
    isDefault: false,
  };
}

function hasModelEntry(
  providerId: string,
  modelId: string,
  models: AvailableModel[]
): boolean {
  const normalizedProviderId = normalizeProviderId(providerId);
  return models.some(
    (entry) =>
      normalizeProviderId(entry.providerId) === normalizedProviderId &&
      entry.modelId === modelId
  );
}

function getPrimaryAgent(catalog: AgentCatalogItem[]): AgentCatalogItem | null {
  return catalog.find((agent) => agent.isPrimary) ?? null;
}

function getSessionSelectionKey(sessionId: string | null): string {
  return sessionId ?? PRE_SESSION_SELECTION_KEY;
}

type SessionSelectionState = {
  manualModel: AvailableModel | null;
  runtimeModel: AvailableModel | null;
  activeAgentId: string | null;
};

function createDefaultSessionSelectionState(
  primaryAgentId: string | null
): SessionSelectionState {
  return {
    manualModel: null,
    runtimeModel: null,
    activeAgentId: primaryAgentId,
  };
}

export type UseWorkspaceOptions = {
  slug: string;
  storageScope?: string;
  /** Poll interval in ms for session status updates */
  pollInterval?: number;
  /** Skip connection attempts when false */
  enabled?: boolean;
  workspaceAgentEnabled?: boolean;
  /** Enable instance heartbeat for idle timeout (web mode) */
  reaperEnabled?: boolean;
};

export type UseWorkspaceReturn = {
  // Connection
  connection: WorkspaceConnectionState;
  isConnected: boolean;

  // Files
  fileTree: WorkspaceFileNode[];
  isLoadingFiles: boolean;
  refreshFiles: () => Promise<void>;
  readFile: (
    path: string
  ) => Promise<{ content: string; type: "raw" | "patch"; hash?: string } | null>;
  writeFile: (
    path: string,
    content: string,
    expectedHash?: string
  ) => Promise<{ ok: boolean; hash?: string; error?: string }>;
  deleteFile: (path: string) => Promise<boolean>;
  applyPatch: (patch: string) => Promise<boolean>;
  discardFileChanges: (path: string) => Promise<{ ok: boolean; error?: string }>;

  // Sessions
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  activeSession: WorkspaceSession | null;
  isLoadingSessions: boolean;
  unseenCompletedSessions: ReadonlySet<string>;
  selectSession: (id: string) => void;
  createSession: (title?: string) => Promise<WorkspaceSession | null>;
  deleteSession: (id: string) => Promise<boolean>;
  renameSession: (id: string, title: string) => Promise<boolean>;

  // Messages
  messages: WorkspaceMessage[];
  isLoadingMessages: boolean;
  isSending: boolean;
  isStartingNewSession: boolean;
  sendMessage: (
    text: string,
    model?: { providerId: string; modelId: string },
    options?: {
      forceNewSession?: boolean;
      attachments?: MessageAttachmentInput[];
      contextPaths?: string[];
    }
  ) => Promise<boolean>;
  abortSession: () => Promise<void>;
  refreshMessages: () => Promise<void>;

  // Diffs
  diffs: WorkspaceDiff[];
  isLoadingDiffs: boolean;
  diffsError: string | null;
  refreshDiffs: () => Promise<void>;

  // Models
  models: AvailableModel[];
  agentDefaultModel: AvailableModel | null;
  selectedModel: AvailableModel | null;
  hasManualModelSelection: boolean;
  setSelectedModel: (model: AvailableModel | null) => void;
  activeAgentName: string | null;

  // Agents
  agentCatalog: AgentCatalogItem[];
};

export function useWorkspace({
  slug,
  storageScope,
  pollInterval = 5000,
  enabled = true,
  workspaceAgentEnabled = true,
  reaperEnabled = true,
}: UseWorkspaceOptions): UseWorkspaceReturn {
  const activeSessionStorageKey = getActiveSessionStorageKey(storageScope ?? slug);

  // --- Sub-hooks ---
  // onConnectedRef holds the real init callback. We declare it as a ref so
  // the connection hook (called first) can invoke whatever function is
  // current at the time the connection succeeds, even though the functions
  // it calls (loadSessions, etc.) are defined later in this hook body.
  const onConnectedRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const { connection, isConnected } = useWorkspaceConnection(
    slug,
    enabled,
    // The connection hook stores this in its own ref, so identity doesn't
    // matter. We pass a thin wrapper that delegates to our ref.
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
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Messages
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, WorkspaceMessage[]>
  >({});
  const [loadingMessageSessionIds, setLoadingMessageSessionIds] = useState<string[]>([]);
  const [sessionStreamStatus, setSessionStreamStatus] = useState<
    Record<string, "submitted" | "streaming" | "error">
  >({});
  const [isStartingNewSession, setIsStartingNewSession] = useState(false);
  const sessionStreamStatusRef = useRef<
    Record<string, "submitted" | "streaming" | "error">
  >({});
  const [unseenCompletedSessions, setUnseenCompletedSessions] = useState<Set<string>>(new Set());
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const sessionMutationVersionRef = useRef(0);
  const sessionLoadRequestIdRef = useRef(0);
  const streamCounterRef = useRef(0);
  const activeStreamsRef = useRef(new Map<string, {
    token: number;
    sessionId: string;
    mode: "send" | "resume";
    targetMessageId: string;
    abortController: AbortController;
  }>());
  const resumeFailureStateRef = useRef<Map<string, ResumeFailureState>>(new Map());
  const sessionExecutorsRef = useRef(new Map<string, SerialJobExecutor>());
  const latestStreamTokensRef = useRef(new Map<string, number>());
  const isMountedRef = useRef(true);

  // Workspace refresh scheduling (diffs + files after stream completion)
  const workspaceRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Models
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalogItem[]>([]);
  const [sessionSelectionState, setSessionSelectionState] = useState<
    Record<string, SessionSelectionState>
  >({});
  const sessionSelectionStateRef = useRef(sessionSelectionState);
  sessionSelectionStateRef.current = sessionSelectionState;

  const messages = useMemo(
    () => (activeSessionId ? messagesBySession[activeSessionId] ?? EMPTY_WORKSPACE_MESSAGES : EMPTY_WORKSPACE_MESSAGES),
    [activeSessionId, messagesBySession]
  );
  const isLoadingMessages = activeSessionId
    ? loadingMessageSessionIds.includes(activeSessionId)
    : false;
  const activeStreamStatus = activeSessionId ? sessionStreamStatus[activeSessionId] : undefined;
  const isSending = activeStreamStatus === "submitted" || activeStreamStatus === "streaming";

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
  const primaryAgent = getPrimaryAgent(agentCatalog);
  const primaryAgentId = primaryAgent?.id ?? null;
  const currentSessionSelection =
    sessionSelectionState[getSessionSelectionKey(activeSessionId)] ??
    createDefaultSessionSelectionState(primaryAgentId);
  const activeCatalogAgent = currentSessionSelection.activeAgentId
    ? findAgentInCatalog(agentCatalog, currentSessionSelection.activeAgentId)
    : undefined;
  const activeAgentName = currentSessionSelection.activeAgentId
    ? activeCatalogAgent?.displayName ?? null
    : null;
  const agentDefaultModel = (() => {
    const primaryModel = parseModelString(primaryAgent?.model);
    if (!primaryModel) return null;

    return resolveModelEntry(
      primaryModel.providerId,
      primaryModel.modelId,
      models
    );
  })();
  const selectedModel =
    currentSessionSelection.manualModel ??
    currentSessionSelection.runtimeModel ??
    agentDefaultModel ??
    models[0] ??
    null;
  const hasManualModelSelection = currentSessionSelection.manualModel !== null;

  // --- Session selection state helpers ---

  const updateSessionSelection = useCallback(
    (
      sessionId: string,
      updater: (current: SessionSelectionState) => SessionSelectionState
    ) => {
      setSessionSelectionState((prev) => {
        const current = prev[sessionId] ?? createDefaultSessionSelectionState(primaryAgentId);
        const next = updater(current);
        if (
          next.manualModel === current.manualModel &&
          next.runtimeModel === current.runtimeModel &&
          next.activeAgentId === current.activeAgentId
        ) {
          return prev;
        }

        return {
          ...prev,
          [sessionId]: next,
        };
      });
    },
    [primaryAgentId]
  );

  const clearSessionSelectionState = useCallback(
    (sessionId: string) => {
      setSessionSelectionState((prev) => {
        if (!(sessionId in prev)) return prev;

        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    },
    []
  );

  const initializeSessionSelectionState = useCallback(
    (sessionId: string, seed?: SessionSelectionState) => {
      updateSessionSelection(sessionId, () =>
        seed
          ? {
              manualModel: seed.manualModel,
              runtimeModel: seed.runtimeModel,
              activeAgentId: seed.activeAgentId,
            }
          : createDefaultSessionSelectionState(primaryAgentId)
      );
    },
    [primaryAgentId, updateSessionSelection]
  );

  const updateSelectedModel = useCallback(
    (model: AvailableModel | null) => {
      const selectionKey = getSessionSelectionKey(activeSessionIdRef.current);

      updateSessionSelection(selectionKey, (current) => ({
        ...current,
        manualModel: model,
      }));
    },
    [updateSessionSelection]
  );

  const syncRuntimeSelectedModel = useCallback(
    (sessionId: string, providerId?: string, modelId?: string) => {
      if (!providerId || !modelId) return;

      const normalizedProviderId = normalizeProviderId(providerId);

      updateSessionSelection(sessionId, (current) => {
        if (
          current.runtimeModel?.providerId === normalizedProviderId &&
          current.runtimeModel?.modelId === modelId
        ) {
          return current;
        }

        return {
          ...current,
          runtimeModel: resolveModelEntry(normalizedProviderId, modelId, models),
        };
      });
    },
    [models, updateSessionSelection]
  );

  const syncActiveAgentFromRuntime = useCallback(
    (sessionId: string, agentId: string) => {
      updateSessionSelection(sessionId, (current) => {
        const resolved = findAgentInCatalog(agentCatalog, agentId);
        if (!resolved) return current;

        return {
          ...current,
          activeAgentId: resolved.id,
        };
      });
    },
    [agentCatalog, updateSessionSelection]
  );

  const extractRuntimeMetadata = useCallback((items: WorkspaceMessage[]) => {
    const reversed = [...items].reverse();

    for (const message of reversed) {
      if (message.role !== "assistant") continue;

      let agentId = message.agentId;
      const parts = [...(message.parts ?? [])].reverse();
      for (const part of parts) {
        if (part.type === "subtask") {
          agentId = part.agent;
          break;
        }
        if (part.type === "agent") {
          agentId = part.name;
          break;
        }
      }

      return {
        agentId: agentId ?? null,
        model: message.model ?? null,
      };
    }

    return { agentId: null, model: null };
  }, []);

  // --- Message helpers ---

  const updateSessionMessages = useCallback(
    (
      sessionId: string,
      updater: SetStateAction<WorkspaceMessage[]>
    ) => {
      setMessagesBySession((prev) => {
        const previousMessages = prev[sessionId] ?? [];
        const nextMessages =
          typeof updater === "function"
            ? updater(previousMessages)
            : updater;

        if (
          nextMessages === previousMessages ||
          areMessageListsEqual(previousMessages, nextMessages)
        ) {
          return prev;
        }

        return {
          ...prev,
          [sessionId]: nextMessages,
        };
      });
    },
    []
  );

  const getSessionExecutor = useCallback((sessionId: string): SerialJobExecutor => {
    let executor = sessionExecutorsRef.current.get(sessionId);
    if (!executor) {
      executor = new SerialJobExecutor();
      sessionExecutorsRef.current.set(sessionId, executor);
    }
    return executor;
  }, []);

  const setSessionLoading = useCallback((sessionId: string, isLoading: boolean) => {
    setLoadingMessageSessionIds((prev) => {
      if (isLoading) {
        return prev.includes(sessionId) ? prev : [...prev, sessionId];
      }

      return prev.filter((id) => id !== sessionId);
    });
  }, []);

  const setSessionStreamStatusTo = useCallback(
    (sessionId: string, status: "submitted" | "streaming" | "error" | "ready") => {
      setSessionStreamStatus((prev) => {
        if (status === "ready") {
          if (!(sessionId in prev)) return prev;

          // If the session was actively streaming and is not the currently
          // viewed session, mark it as "unseen completed" so the UI can
          // show a green indicator until the user visits it.
          const wasStreaming = prev[sessionId] === "submitted" || prev[sessionId] === "streaming";
          if (wasStreaming && sessionId !== activeSessionIdRef.current) {
            setUnseenCompletedSessions((s) => {
              if (s.has(sessionId)) return s;
              const next = new Set(s);
              next.add(sessionId);
              return next;
            });
          }

          const next = { ...prev };
          delete next[sessionId];
          sessionStreamStatusRef.current = next;
          return next;
        }

        if (prev[sessionId] === status) return prev;

        const next = { ...prev, [sessionId]: status };
        sessionStreamStatusRef.current = next;
        return next;
      });
    },
    []
  );

  const syncRuntimeMetadataForSession = useCallback(
    (sessionId: string, items: WorkspaceMessage[]) => {
      const runtime = extractRuntimeMetadata(items);
      updateSessionSelection(sessionId, (current) => ({
        ...current,
        activeAgentId: runtime.agentId
          ? findAgentInCatalog(agentCatalog, runtime.agentId)?.id ?? current.activeAgentId
          : primaryAgentId,
        runtimeModel: runtime.model
          ? resolveModelEntry(runtime.model.providerId, runtime.model.modelId, models)
          : null,
      }));
    },
    [agentCatalog, extractRuntimeMetadata, models, primaryAgentId, updateSessionSelection]
  );

  const markSessionsMutated = useCallback(() => {
    sessionMutationVersionRef.current += 1;
    return sessionMutationVersionRef.current;
  }, []);

  // --- Sessions ---

  const loadSessions = useCallback(async () => {
    const requestId = sessionLoadRequestIdRef.current + 1;
    sessionLoadRequestIdRef.current = requestId;
    const mutationVersionAtStart = sessionMutationVersionRef.current;

    console.log("[useWorkspace] loadSessions: loading...");
    setIsLoadingSessions(true);
    try {
      const result = await listSessionsAction(slug);
      console.log(
        "[useWorkspace] loadSessions result:",
        result.ok,
        "sessions:",
        result.sessions?.length
      );
      if (result.ok && result.sessions) {
        if (requestId !== sessionLoadRequestIdRef.current) {
          return;
        }

        if (mutationVersionAtStart !== sessionMutationVersionRef.current) {
          return;
        }

        const sessions = result.sessions;

        setSessions(sessions);
        const sessionIds = new Set(sessions.map((session) => session.id));
        setSessionSelectionState((prev) => {
          let changed = false;
          const next: Record<string, SessionSelectionState> = {};

          for (const [sessionId, state] of Object.entries(prev)) {
            if (!sessionIds.has(sessionId)) {
              changed = true;
              continue;
            }
            next[sessionId] = state;
          }

          return changed ? next : prev;
        });
        const currentSessionId = activeSessionIdRef.current;
        const storedSessionId = loadStoredActiveSessionId(activeSessionStorageKey);
        const firstRootSession = sessions.find(
          (session) => !session.parentId || !sessionIds.has(session.parentId)
        );
        const nextActiveSessionId =
          (currentSessionId && sessionIds.has(currentSessionId)
            ? currentSessionId
            : null) ??
          (storedSessionId && sessionIds.has(storedSessionId)
            ? storedSessionId
            : null) ??
          firstRootSession?.id ??
          sessions[0]?.id ??
          null;

        if (nextActiveSessionId !== currentSessionId) {
          console.log(
            "[useWorkspace] Selecting session after load:",
            nextActiveSessionId
          );
          activeSessionIdRef.current = nextActiveSessionId;
          setActiveSessionId(nextActiveSessionId);
        }
      }
    } finally {
      if (requestId === sessionLoadRequestIdRef.current) {
        setIsLoadingSessions(false);
      }
    }
  }, [activeSessionStorageKey, slug]);

  // --- Stream management ---

  const abortSessionStream = useCallback(
    (sessionId: string) => {
      const activeStream = activeStreamsRef.current.get(sessionId);
      if (!activeStream) return;

      activeStream.abortController.abort();
      activeStreamsRef.current.delete(sessionId);
      if (latestStreamTokensRef.current.get(sessionId) === activeStream.token) {
        latestStreamTokensRef.current.delete(sessionId);
      }
      streamCounterRef.current += 1;
      setSessionStreamStatusTo(sessionId, "ready");
    },
    [setSessionStreamStatusTo]
  );

  const abortAllStreams = useCallback(() => {
    for (const sessionId of activeStreamsRef.current.keys()) {
      const activeStream = activeStreamsRef.current.get(sessionId);
      activeStream?.abortController.abort();
      latestStreamTokensRef.current.delete(sessionId);
      setSessionStreamStatusTo(sessionId, "ready");
    }
    activeStreamsRef.current.clear();
    streamCounterRef.current += 1;
  }, [setSessionStreamStatusTo]);

  const selectSession = useCallback(
    (id: string) => {
      setActiveSessionId(id);
      activeSessionIdRef.current = id;

      // Clear "unseen completed" flag when the user visits this session
      setUnseenCompletedSessions((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    []
  );

  const createSession = useCallback(
    async (title?: string) => {
      const result = await createSessionAction(slug, title);
      if (result.ok && result.session) {
        const draftSelection = sessionSelectionStateRef.current[PRE_SESSION_SELECTION_KEY];
        markSessionsMutated();
        setSessions((prev) => [result.session!, ...prev]);
        setActiveSessionId(result.session.id);
        activeSessionIdRef.current = result.session.id;
        updateSessionMessages(result.session.id, []);
        initializeSessionSelectionState(result.session.id, draftSelection);
        if (draftSelection) {
          clearSessionSelectionState(PRE_SESSION_SELECTION_KEY);
        }
        return result.session;
      }
      return null;
    },
    [
      clearSessionSelectionState,
      initializeSessionSelectionState,
      markSessionsMutated,
      slug,
      updateSessionMessages,
    ]
  );

  const deleteSession = useCallback(
    async (id: string) => {
      const result = await deleteSessionAction(slug, id);
      if (result.ok) {
        markSessionsMutated();
        abortSessionStream(id);
        setSessions((prev) => {
          const filtered = prev.filter((s) => s.id !== id);
          const nextActiveSessionId =
            activeSessionIdRef.current === id
              ? filtered[0]?.id ?? null
              : activeSessionIdRef.current;

          activeSessionIdRef.current = nextActiveSessionId;
          setActiveSessionId(nextActiveSessionId);
          return filtered;
        });
        setMessagesBySession((prev) => {
          if (!(id in prev)) return prev;

          const next = { ...prev };
          delete next[id];
          return next;
        });
        setLoadingMessageSessionIds((prev) => prev.filter((sessionId) => sessionId !== id));
        setSessionStreamStatusTo(id, "ready");
        clearSessionSelectionState(id);
        sessionExecutorsRef.current.delete(id);
        return true;
      }
      return false;
    },
    [
      abortSessionStream,
      clearSessionSelectionState,
      markSessionsMutated,
      setSessionStreamStatusTo,
      slug,
    ]
  );

  const renameSession = useCallback(
    async (id: string, title: string) => {
      const nextTitle = title.trim();
      if (!nextTitle) return false;

      markSessionsMutated();
      const result = await updateSessionAction(slug, id, nextTitle);
      if (result.ok) {
        setSessions((prev) =>
          prev.map((session) => {
            if (session.id !== id) return session;

            return {
              ...session,
              ...(result.session ?? {}),
              title: nextTitle,
            };
          })
        );
        return true;
      }

      // On failure, re-sync from backend to restore the real state.
      void loadSessions();
      return false;
    },
    [loadSessions, markSessionsMutated, slug]
  );

  // --- Messages ---

  const refreshMessages = useCallback(async (sessionIdOverride?: string) => {
    const targetSessionId = sessionIdOverride ?? activeSessionIdRef.current;

    if (!targetSessionId) {
      console.log(
        "[useWorkspace] refreshMessages: no activeSessionId, skipping"
      );
      return;
    }

    const targetStatus = sessionStreamStatusRef.current[targetSessionId];
    if (
      targetStatus === "submitted" || targetStatus === "streaming" ||
      activeStreamsRef.current.has(targetSessionId)
    ) {
      console.log(
        "[useWorkspace] refreshMessages: skipping, active stream in progress"
      );
      return;
    }

    const executor = getSessionExecutor(targetSessionId);
    await executor.run(async () => {
      console.log(
        "[useWorkspace] refreshMessages: loading for session",
        targetSessionId
      );
      setSessionLoading(targetSessionId, true);
      try {
        const result = await listMessagesAction(slug, targetSessionId);

        console.log(
          "[useWorkspace] refreshMessages result:",
          result.ok,
          "messages:",
          result.messages?.length
        );
        if (result.ok && result.messages) {
          const pendingIds = new Set(
            result.messages.filter((message) => message.pending).map((message) => message.id)
          );
          for (const [messageId] of resumeFailureStateRef.current) {
            if (!pendingIds.has(messageId)) {
              resumeFailureStateRef.current.delete(messageId);
            }
          }

          const hydratedMessages: WorkspaceMessage[] = result.messages.map(
            (message): WorkspaceMessage => {
              const resumeState = resumeFailureStateRef.current.get(message.id);
              if (
                message.role === "assistant" &&
                message.pending &&
                resumeState?.suppressed
              ) {
                return {
                  ...message,
                  pending: false,
                  statusInfo: { status: "error", detail: "resume_exhausted" },
                };
              }

              return message;
            }
          );

          updateSessionMessages(targetSessionId, hydratedMessages);
          syncRuntimeMetadataForSession(targetSessionId, hydratedMessages);
        }
      } finally {
        setSessionLoading(targetSessionId, false);
      }
    });
  }, [
    slug,
    getSessionExecutor,
    setSessionLoading,
    syncRuntimeMetadataForSession,
    updateSessionMessages,
  ]);

  // --- SSE streaming ---

  const deriveStatusInfoFromPart = useCallback((part: MessagePart) => {
    switch (part.type) {
      case "reasoning":
        return { status: "reasoning" as const };
      case "text":
        return { status: "writing" as const };
      case "tool": {
        const stateTitle =
          "title" in part.state && typeof part.state.title === "string"
            ? part.state.title
            : undefined;
        const stateError =
          "error" in part.state && typeof part.state.error === "string"
            ? part.state.error
            : undefined;

        const taskAgent =
          part.name === "task" &&
          part.state.input &&
          typeof part.state.input.subagent_type === "string"
            ? part.state.input.subagent_type
            : undefined;

        const toolDetail = taskAgent
          ? `to ${taskAgent.charAt(0).toUpperCase() + taskAgent.slice(1)}`
          : stateTitle;

        if (part.state.status === "error") {
          return {
            status: "error" as const,
            toolName: part.name,
            detail: stateError,
          };
        }
        if (
          part.state.status === "running" ||
          part.state.status === "pending"
        ) {
          return {
            status: "tool-calling" as const,
            toolName: part.name,
            detail: toolDetail,
          };
        }
        return { status: "thinking" as const };
      }
      case "step-start":
        return { status: "thinking" as const };
      case "retry":
        return { status: "thinking" as const };
      default:
        return null;
    }
  }, []);

  const upsertMessagePart = useCallback(
    (sessionId: string, messageId: string, part: MessagePart) => {
      updateSessionMessages(sessionId, (prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const nextParts = m.parts ? [...m.parts] : [];
          const partId = "id" in part ? part.id : undefined;
          if (partId) {
            const existingIndex = nextParts.findIndex(
              (p) => ("id" in p ? p.id : undefined) === partId
            );
            if (existingIndex >= 0) {
              nextParts[existingIndex] = part;
            } else {
              nextParts.push(part);
            }
          } else {
            nextParts.push(part);
          }

          const statusInfo = deriveStatusInfoFromPart(part);

          return {
            ...m,
            parts: nextParts,
            content: extractTextContent(nextParts),
            pending: true,
            statusInfo: statusInfo ?? m.statusInfo,
          };
        })
      );
    },
    [deriveStatusInfoFromPart, updateSessionMessages]
  );

  const scheduleWorkspaceRefresh = useCallback(() => {
    if (workspaceRefreshTimeoutRef.current) return;

    workspaceRefreshTimeoutRef.current = setTimeout(() => {
      workspaceRefreshTimeoutRef.current = null;
      diffsHook.triggerDiffsRefresh();
      void files.refreshFiles();
    }, 250);
  }, [diffsHook, files]);

  type StreamMode = "send" | "resume";
  type StreamOptions = {
    sessionId: string;
    mode: StreamMode;
    targetMessageId: string;
    text?: string;
    model?: { providerId: string; modelId: string };
    attachments?: MessageAttachmentInput[];
    contextPaths?: string[];
  };

  const streamChat = useCallback(
    async ({
      sessionId,
      mode,
      targetMessageId,
      text,
      model,
      attachments,
      contextPaths,
    }: StreamOptions) => {
      abortSessionStream(sessionId);

      const token = streamCounterRef.current + 1;
      streamCounterRef.current = token;
      const abortController = new AbortController();
      activeStreamsRef.current.set(sessionId, {
        token,
        sessionId,
        mode,
        targetMessageId,
        abortController,
      });
      latestStreamTokensRef.current.set(sessionId, token);

      setSessionStreamStatusTo(sessionId, "submitted");

      if (mode === "resume") {
        updateSessionMessages(sessionId, (prev) =>
          prev.map((m) =>
            m.id === targetMessageId
              ? {
                  ...m,
                  pending: true,
                  statusInfo: m.statusInfo ?? { status: "thinking" },
                }
              : m
          )
        );
      }

      let assistantMessageId: string | null =
        mode === "resume" ? targetMessageId : null;
      const bufferedParts = new Map<string, MessagePart[]>();
      const textAccumulatorByPart = new Map<string, string>();
      let streamCompleted = false;
      let receivedAssistantPart = false;
      let receivedStreamData = false;
      let terminalErrorDetail: string | null = null;
      let resumePollInterval: ReturnType<typeof setInterval> | null = null;

      // Pre-check: if the message has already completed (e.g. OpenCode
      // finished while the page was reloading), skip the SSE subscription.
      if (mode === "resume") {
        const preCheck = await listMessagesAction(slug, sessionId);
        if (preCheck.ok && preCheck.messages) {
          const target = preCheck.messages.find((m) => m.id === targetMessageId);
          if (target && !target.pending) {
            resumeFailureStateRef.current.delete(targetMessageId);
            updateSessionMessages(sessionId, preCheck.messages);
            syncRuntimeMetadataForSession(sessionId, preCheck.messages);
            activeStreamsRef.current.delete(sessionId);
            setSessionStreamStatusTo(sessionId, "ready");
            scheduleWorkspaceRefresh();
            return;
          }
        }
      }

      const flushBufferedParts = (messageId: string) => {
        const buffered = bufferedParts.get(messageId);
        if (!buffered || buffered.length === 0) return;
        receivedAssistantPart = true;
        buffered.forEach((part) => upsertMessagePart(sessionId, targetMessageId, part));
        bufferedParts.delete(messageId);
      };

      const handlePartUpdate = (part: unknown, delta: unknown, messageId?: string) => {
        if (!messageId) return;
        const withDelta = applyDeltaToPart(messageId, part, delta, textAccumulatorByPart);
        const transformed = transformParts([withDelta]);
        if (transformed.length === 0) return;

        if (mode === "resume") {
          if (messageId !== targetMessageId) return;
          receivedAssistantPart = true;
          transformed.forEach((p) => upsertMessagePart(sessionId, targetMessageId, p));
          return;
        }

        if (assistantMessageId) {
          if (messageId !== assistantMessageId) return;
          receivedAssistantPart = true;
          transformed.forEach((p) => upsertMessagePart(sessionId, targetMessageId, p));
          return;
        }

        const existing = bufferedParts.get(messageId) ?? [];
        existing.push(...transformed);
        bufferedParts.set(messageId, existing);
      };

      const updateStatus = (
        status: MessageStatus,
        toolName?: string,
        detail?: string
      ) => {
        const isTerminal = status === "complete" || status === "error";
        updateSessionMessages(sessionId, (prev) =>
          prev.map((m) => {
            if (m.id !== targetMessageId) return m;
            return {
              ...m,
              pending: !isTerminal,
              statusInfo: { status, toolName, detail },
            };
          })
        );
      };

      try {
        const response = await fetch(`/api/w/${slug}/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            text,
            model,
            attachments,
            contextPaths,
            resume: mode === "resume",
            messageId: mode === "resume" ? targetMessageId : undefined,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: "Failed to send message" }));
          throw new Error(error.error || "Failed to send message");
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        // During resume, periodically poll the message API so we detect
        // completion even when no SSE events arrive (e.g. subagent work
        // produces events on the child session, not the parent).
        if (mode === "resume") {
          resumePollInterval = setInterval(async () => {
            try {
              const poll = await listMessagesAction(slug, sessionId);
              if (poll.ok && poll.messages) {
                const target = poll.messages.find((m) => m.id === targetMessageId);
                if (target && !target.pending) {
                  streamCompleted = true;
                  updateSessionMessages(sessionId, poll.messages);
                  syncRuntimeMetadataForSession(sessionId, poll.messages);
                  abortController.abort();
                }
              }
            } catch {
              // Ignore individual poll errors
            }
          }, RESUME_POLL_INTERVAL_MS);
        }

        const decoder = new TextDecoder();
        let parseState = INITIAL_SSE_PARSE_STATE;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const parsed = parseSseChunk(parseState, decoder.decode(value, { stream: true }));
          parseState = parsed.state;

          for (const parsedEvent of parsed.events) {
            try {
              receivedStreamData = true;
              setSessionStreamStatusTo(sessionId, "streaming");
              const data = JSON.parse(parsedEvent.data);

              switch (parsedEvent.event) {
                case "status": {
                  const status = data.status as MessageStatus;
                  updateStatus(status, data.toolName, data.detail);
                  if (status === "complete" || status === "error") {
                    streamCompleted = true;
                  }
                  break;
                }

                case "message": {
                  if (
                    mode === "send" &&
                    data.role === "assistant" &&
                    !assistantMessageId &&
                    typeof data.id === "string"
                  ) {
                    assistantMessageId = data.id;
                    flushBufferedParts(data.id);
                  }
                  break;
                }

                case "assistant-meta": {
                  if (typeof data.providerID === "string" && typeof data.modelID === "string") {
                    syncRuntimeSelectedModel(sessionId, data.providerID, data.modelID);
                  }
                  if (typeof data.agent === "string") {
                    syncActiveAgentFromRuntime(sessionId, data.agent);
                  }
                  break;
                }

                case "agent": {
                  if (typeof data.agent === "string") {
                    syncActiveAgentFromRuntime(sessionId, data.agent);
                  }
                  break;
                }

                case "part": {
                  if (!data.part) break;
                  const messageId = data.messageId ?? data.part?.messageID;
                  handlePartUpdate(data.part, data.delta, messageId);
                  break;
                }

                case "workspace-updated": {
                  scheduleWorkspaceRefresh();
                  break;
                }

                  case "done": {
                    updateStatus("complete");
                    streamCompleted = true;
                    break;
                  }

                case "error": {
                  terminalErrorDetail = typeof data.error === "string" ? data.error : terminalErrorDetail;
                  updateStatus("error", undefined, data.error);
                  streamCompleted = true;
                  break;
                }
              }
            } catch {
              // Invalid JSON, skip
            }
          }

          // In Electron's Turbopack dev server, the HTTP response body doesn't
          // signal EOF after controller.close(), so reader.read() hangs
          // indefinitely. Break as soon as the server signals completion.
          if (streamCompleted) {
            reader.cancel().catch(() => {});
            break;
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error("[useWorkspace] Streaming error:", error);
        terminalErrorDetail = error instanceof Error ? error.message : "Unknown error";
        updateStatus(
          "error",
          undefined,
          terminalErrorDetail
        );
      } finally {
        if (resumePollInterval) {
          clearInterval(resumePollInterval);
        }

        const isLatestStream = () => latestStreamTokensRef.current.get(sessionId) === token;

        if (mode === "resume") {
          if (streamCompleted || receivedAssistantPart) {
            resumeFailureStateRef.current.delete(targetMessageId);
          } else {
            // If the session is still actively processing, don't record a
            // resume failure — the auto-resume effect will retry once the
            // pending key is re-evaluated after the next message refresh.
            const sessionStillBusy =
              sessionsRef.current.find((s) => s.id === sessionId)?.status === "busy";

            if (!sessionStillBusy) {
              const nextState = recordResumeFailure(
                resumeFailureStateRef.current.get(targetMessageId),
                Date.now()
              );
              resumeFailureStateRef.current.set(targetMessageId, nextState);

              updateStatus(
                "error",
                undefined,
                nextState.suppressed ? "resume_exhausted" : "resume_incomplete"
              );
            }
          }
        }

        if (isLatestStream()) {
          activeStreamsRef.current.delete(sessionId);
          if (isMountedRef.current) {
            setSessionStreamStatusTo(sessionId, "ready");
          }
        }

        if (isLatestStream() && isMountedRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (!isMountedRef.current || !isLatestStream()) {
            return;
          }

          const loadLatestMessages = async () => {
            const MAX_ATTEMPTS =
              mode === "send" && assistantMessageId ? 5 : 1;
            let latestResult = await listMessagesAction(slug, sessionId);

            for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
              if (!latestResult.ok || !latestResult.messages) {
                return latestResult;
              }

              const assistant = latestResult.messages.find(
                (message) =>
                  message.id === assistantMessageId &&
                  message.role === "assistant"
              );

              if (assistant) {
                return latestResult;
              }

              // Exponential backoff: 250ms, 500ms, 1000ms, 2000ms
              const delay = 250 * Math.pow(2, attempt - 1);
              await new Promise((resolve) => setTimeout(resolve, delay));
              latestResult = await listMessagesAction(slug, sessionId);
            }

            return latestResult;
          };

          const result = await loadLatestMessages();
          if (!isMountedRef.current || !isLatestStream()) {
            return;
          }

          if (result?.ok && result.messages) {
            const pendingIds = new Set(
              result.messages.filter((message) => message.pending).map((message) => message.id)
            );
            for (const [messageId] of resumeFailureStateRef.current) {
              if (!pendingIds.has(messageId)) {
                resumeFailureStateRef.current.delete(messageId);
              }
            }

            let hydratedMessages: WorkspaceMessage[] = result.messages.map(
              (message): WorkspaceMessage => {
                const resumeState = resumeFailureStateRef.current.get(message.id);
                if (
                  message.role === "assistant" &&
                  message.pending &&
                  resumeState?.suppressed
                ) {
                  return {
                    ...message,
                    pending: false,
                    statusInfo: { status: "error", detail: "resume_exhausted" },
                  };
                }

                return message;
              }
            );

            if (mode === "send" && assistantMessageId && !receivedAssistantPart) {
              const assistantMessage = hydratedMessages.find(
                (message) =>
                  message.id === assistantMessageId &&
                  message.role === "assistant"
              );

              if (
                assistantMessage &&
                !assistantMessage.pending &&
                assistantMessage.parts.length === 0 &&
                assistantMessage.content.trim().length === 0
              ) {
                hydratedMessages = hydratedMessages.map((message) => {
                  if (message.id !== assistantMessageId) return message;
                  return {
                    ...message,
                    pending: false,
                    statusInfo: {
                      status: "error",
                      detail: terminalErrorDetail ?? "stream_incomplete",
                    },
                  };
                });
              }
            }

            if (
              mode === "send" &&
              !receivedStreamData &&
              terminalErrorDetail &&
              hydratedMessages.length === 0
            ) {
              const fallbackTerminalErrorDetail = terminalErrorDetail;
              const idToUpdate = assistantMessageId ?? targetMessageId;

              updateSessionMessages(sessionId, (prev) =>
                prev.map((message) => {
                  if (message.id !== idToUpdate) return message;
                  return {
                    ...message,
                    pending: false,
                    statusInfo: { status: "error", detail: fallbackTerminalErrorDetail },
                  };
                })
              );
            } else if (
              mode === "send" &&
              terminalErrorDetail &&
              !assistantMessageId
            ) {
              // Stream received initial events (e.g. "thinking" status) but
              // the prompt failed before creating an assistant message on the
              // server. Preserve temp messages and show error.
              const fallbackDetail = terminalErrorDetail;

              updateSessionMessages(sessionId, (prev) =>
                prev.map((message) => {
                  if (message.id !== targetMessageId) return message;
                  return {
                    ...message,
                    pending: false,
                    statusInfo: { status: "error", detail: fallbackDetail },
                  };
                })
              );
            } else {
              updateSessionMessages(sessionId, hydratedMessages);
              syncRuntimeMetadataForSession(sessionId, hydratedMessages);
            }
          } else {
            if (!streamCompleted && !receivedAssistantPart) {
              updateStatus(
                "error",
                undefined,
                terminalErrorDetail ?? "stream_incomplete"
              );
            }
          }
          scheduleWorkspaceRefresh();
        }

        if (isLatestStream()) {
          latestStreamTokensRef.current.delete(sessionId);
        }
      }
    },
    [
      abortSessionStream,
      slug,
      upsertMessagePart,
      syncActiveAgentFromRuntime,
      syncRuntimeSelectedModel,
      scheduleWorkspaceRefresh,
      setSessionStreamStatusTo,
      syncRuntimeMetadataForSession,
      updateSessionMessages,
    ]
  );

  // --- Send message ---

  const sendMessage = useCallback(
    async (
      text: string,
      model?: { providerId: string; modelId: string },
      options?: {
        forceNewSession?: boolean;
        attachments?: MessageAttachmentInput[];
        contextPaths?: string[];
      }
    ) => {
      console.log("[useWorkspace] sendMessage called", {
        text,
        model,
        activeSessionId: activeSessionIdRef.current,
        options,
      });

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
        if (forceNewSession) {
          setIsStartingNewSession(true);
        }

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
          createDefaultSessionSelectionState(primaryAgentId);

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
      agentDefaultModel,
      models,
      primaryAgentId,
      streamChat,
      updateSessionMessages,
    ]
  );

  // --- Abort ---

  const abortSession = useCallback(async () => {
    if (!activeSessionId) return;
    updateSessionMessages(activeSessionId, (prev) =>
      prev.map((message) => {
        if (message.role !== "assistant" || !message.pending) return message;

        return {
          ...message,
          pending: false,
          statusInfo: { status: "error", detail: "cancelled" },
        };
      })
    );
    abortSessionStream(activeSessionId);
    await abortSessionAction(slug, activeSessionId);
  }, [abortSessionStream, activeSessionId, slug, updateSessionMessages]);

  // --- Models & agents loading ---

  const loadModels = useCallback(async () => {
    const result = await listModelsAction(slug);
    if (!result.ok || !result.models) return;

    let nextModels = result.models;

    try {
      const response = await fetch(`/api/u/${slug}/providers`, {
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as {
          providers?: ProviderStatusEntry[];
        };
        nextModels = filterModelsByProviderStatus(
          nextModels,
          data.providers ?? []
        );
      }
    } catch {
      // ignore — fall back to server action list
    }

    setModels(nextModels);

    setSessionSelectionState((prev) => {
      let changed = false;
      const next: Record<string, SessionSelectionState> = {};

      for (const [sessionId, state] of Object.entries(prev)) {
        const manualModel = state.manualModel
          ? hasModelEntry(state.manualModel.providerId, state.manualModel.modelId, nextModels)
            ? resolveModelEntry(
                state.manualModel.providerId,
                state.manualModel.modelId,
                nextModels
              )
            : null
          : null;
        const runtimeModel = state.runtimeModel
          ? resolveModelEntry(
              state.runtimeModel.providerId,
              state.runtimeModel.modelId,
              nextModels
            )
          : null;
        const nextState: SessionSelectionState = {
          ...state,
          manualModel,
          runtimeModel,
        };

        next[sessionId] = nextState;
        if (
          nextState.manualModel !== state.manualModel ||
          nextState.runtimeModel !== state.runtimeModel
        ) {
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [slug]);

  const loadAgentCatalog = useCallback(async () => {
    try {
      const response = await fetch(`/api/u/${slug}/agents`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as {
        agents?: AgentCatalogItem[];
      } | null;
      if (!response.ok || !data?.agents) return;
      const agents = data.agents;
      const primary = agents.find((agent) => agent.isPrimary);

      setAgentCatalog(agents);
      setSessionSelectionState((prev) => {
        let changed = false;
        const next: Record<string, SessionSelectionState> = {};

        for (const [sessionId, state] of Object.entries(prev)) {
          const resolvedCurrent = state.activeAgentId
            ? findAgentInCatalog(agents, state.activeAgentId)
            : undefined;
          const nextState: SessionSelectionState = {
            ...state,
            activeAgentId: resolvedCurrent?.id ?? primary?.id ?? state.activeAgentId,
          };

          next[sessionId] = nextState;
          if (nextState.activeAgentId !== state.activeAgentId) {
            changed = true;
          }
        }

        return changed ? next : prev;
      });
    } catch {
      // keep defaults when catalog is unavailable
    }
  }, [slug]);

  // Wire the real init callback now that all functions are defined.
  onConnectedRef.current = async () => {
    await Promise.all([
      files.refreshFiles(),
      loadSessions(),
      loadModels(),
      loadAgentCatalog(),
      diffsHook.refreshDiffs({ force: true }),
    ]);
  };

  // --- Effects ---

  // Persist active session to storage
  useEffect(() => {
    persistActiveSessionId(activeSessionStorageKey, activeSessionId);
  }, [activeSessionId, activeSessionStorageKey]);

  // Load messages when active session changes
  useEffect(() => {
    console.log(
      "[useWorkspace] activeSessionId changed:",
      activeSessionId,
      "isConnected:",
      isConnected
    );
    if (activeSessionId && isConnected) {
      refreshMessages(activeSessionId);
    }
  }, [activeSessionId, isConnected, refreshMessages]);

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
    if (!activeSessionId || !isConnected) return;
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
    isConnected,
    pendingAssistantKey,
    streamChat,
    updateSessionMessages,
  ]);

  // Poll for session status updates
  useEffect(() => {
    if (!isConnected || pollInterval <= 0) return;

    const interval = setInterval(() => {
      loadSessions();

      const currentSessions = sessionsRef.current;
      const currentActiveSessionId = activeSessionIdRef.current;
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
    loadSessions,
    pollInterval,
    diffsHook,
    refreshMessages,
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
  }, [abortAllStreams]);

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
    activeSessionId,
    activeSession,
    isLoadingSessions,
    unseenCompletedSessions,
    selectSession,
    createSession,
    deleteSession,
    renameSession,
    messages,
    isLoadingMessages,
    isSending,
    isStartingNewSession,
    sendMessage,
    abortSession,
    refreshMessages,
    diffs: diffsHook.diffs,
    isLoadingDiffs: diffsHook.isLoadingDiffs,
    diffsError: diffsHook.diffsError,
    refreshDiffs: diffsHook.refreshDiffs,
    models,
    agentDefaultModel,
    selectedModel,
    hasManualModelSelection,
    setSelectedModel: updateSelectedModel,
    activeAgentName,
    agentCatalog,
  };
}

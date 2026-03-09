"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkConnectionAction,
  listSessionsAction,
  createSessionAction,
  deleteSessionAction,
  updateSessionAction,
  listMessagesAction,
  abortSessionAction,
  loadFileTreeAction,
  readFileAction,
  getWorkspaceDiffsAction,
  listModelsAction,
} from "@/actions/opencode";
import {
  readWorkspaceFileAction,
  writeWorkspaceFileAction,
  deleteWorkspaceFileAction,
  applyWorkspacePatchAction,
  discardWorkspaceFileChangesAction,
} from "@/actions/workspace-agent";
import type {
  WorkspaceFileNode,
  WorkspaceSession,
  WorkspaceMessage,
  WorkspaceConnectionState,
  AvailableModel,
  MessageStatus,
  MessagePart,
} from "@/lib/opencode/types";
import { extractTextContent, transformParts } from "@/lib/opencode/transform";
import { PROVIDERS, type ProviderId } from "@/lib/providers/types";
import {
  canAutoResume,
  recordResumeFailure,
  type ResumeFailureState,
} from "@/lib/workspace-resume-policy";
import type { MessageAttachmentInput } from "@/types/workspace";

export type WorkspaceDiff = {
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
  diff: string;
  conflicted: boolean;
};

export type AgentCatalogItem = {
  id: string;
  displayName: string;
  model?: string;
  isPrimary: boolean;
};

const STALE_PENDING_ASSISTANT_MS = 5_000;
const INSTANCE_ACTIVITY_HEARTBEAT_MS = 20_000;

function getActiveSessionStorageKey(slug: string): string {
  return `arche.workspace.${slug}.active-session`;
}

function loadStoredActiveSessionId(key: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(key);
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

function persistActiveSessionId(key: string, sessionId: string | null): void {
  if (typeof window === "undefined") return;

  try {
    if (sessionId) {
      window.localStorage.setItem(key, sessionId);
      return;
    }

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
  const match = models.find(
    (entry) => entry.providerId === providerId && entry.modelId === modelId
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
  return models.some(
    (entry) => entry.providerId === providerId && entry.modelId === modelId
  );
}

function getPrimaryAgent(catalog: AgentCatalogItem[]): AgentCatalogItem | null {
  return catalog.find((agent) => agent.isPrimary) ?? null;
}

export type UseWorkspaceOptions = {
  slug: string;
  /** Poll interval in ms for session status updates */
  pollInterval?: number;
  /** Skip connection attempts when false */
  enabled?: boolean;
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
  ) => Promise<void>;
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
  pollInterval = 5000,
  enabled = true,
}: UseWorkspaceOptions): UseWorkspaceReturn {
  const activeSessionStorageKey = getActiveSessionStorageKey(slug);
  // Connection state
  const [connection, setConnection] = useState<WorkspaceConnectionState>({
    status: "connecting",
  });

  // Files
  const [fileTree, setFileTree] = useState<WorkspaceFileNode[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Messages
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isStartingNewSession, setIsStartingNewSession] = useState(false);
  const isSendingRef = useRef(false); // Ref to track sending state without causing re-renders
  // Sync ref so async callbacks can read the *current* activeSessionId
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const streamCounterRef = useRef(0);
  const activeStreamRef = useRef<{
    token: number;
    sessionId: string;
    mode: "send" | "resume";
    targetMessageId: string;
    abortController: AbortController;
  } | null>(null);
  const resumeFailureStateRef = useRef<Map<string, ResumeFailureState>>(new Map());

  // Diffs
  const [diffs, setDiffs] = useState<WorkspaceDiff[]>([]);
  const [isLoadingDiffs, setIsLoadingDiffs] = useState(false);
  const [diffsError, setDiffsError] = useState<string | null>(null);
  const [diffsRefreshTrigger, setDiffsRefreshTrigger] = useState(0);
  const [filesRefreshTrigger, setFilesRefreshTrigger] = useState(0);
  const isLoadingDiffsRef = useRef(false);
  const workspaceRefreshTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // Models
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [manualSelectedModel, setManualSelectedModel] = useState<AvailableModel | null>(
    null
  );
  const [runtimeSelectedModel, setRuntimeSelectedModel] = useState<AvailableModel | null>(
    null
  );
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalogItem[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

  const isConnected = connection.status === "connected";

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeCatalogAgent = activeAgentId
    ? findAgentInCatalog(agentCatalog, activeAgentId)
    : undefined;
  const activeAgentName = activeAgentId
    ? activeCatalogAgent?.displayName ?? null
    : null;
  const primaryAgent = getPrimaryAgent(agentCatalog);
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
    manualSelectedModel ?? runtimeSelectedModel ?? agentDefaultModel;
  const hasManualModelSelection = manualSelectedModel !== null;

  const resetSessionSelectionState = useCallback(() => {
    setManualSelectedModel(null);
    setRuntimeSelectedModel(null);
    setActiveAgentId(primaryAgent?.id ?? null);
  }, [primaryAgent]);

  const updateSelectedModel = useCallback((model: AvailableModel | null) => {
    setManualSelectedModel(model);
  }, []);

  const syncRuntimeSelectedModel = useCallback(
    (providerId?: string, modelId?: string) => {
      if (!providerId || !modelId) return;

      setRuntimeSelectedModel((current) => {
        if (
          current?.providerId === providerId &&
          current?.modelId === modelId
        ) {
          return current;
        }

        return resolveModelEntry(providerId, modelId, models);
      });
    },
    [models]
  );

  const syncActiveAgentFromRuntime = useCallback(
    (agentId: string) => {
      setActiveAgentId((current) => {
        const resolved = findAgentInCatalog(agentCatalog, agentId);
        if (resolved) return resolved.id;
        return current;
      });
    },
    [agentCatalog]
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

  // Check connection
  const checkConnection = useCallback(async () => {
    const result = await checkConnectionAction(slug);
    setConnection(result);
    return result.status === "connected";
  }, [slug]);

  // Load files
  const refreshFiles = useCallback(async () => {
    setIsLoadingFiles(true);
    try {
      const result = await loadFileTreeAction(slug);
      if (result.ok && result.tree) {
        setFileTree(result.tree);
      }
    } finally {
      setIsLoadingFiles(false);
    }
  }, [slug]);

  // Read single file
  const readFile = useCallback(
    async (path: string) => {
      const agentResult = await readWorkspaceFileAction(slug, path);
      if (agentResult.ok && agentResult.content) {
        return {
          content: agentResult.content.content,
          type: agentResult.content.type,
          hash: agentResult.hash,
        };
      }

      const result = await readFileAction(slug, path);
      if (result.ok && result.content) {
        return { content: result.content.content, type: result.content.type };
      }

      return null;
    },
    [slug]
  );

  const writeFile = useCallback(
    async (path: string, content: string, expectedHash?: string) => {
      const result = await writeWorkspaceFileAction(
        slug,
        path,
        content,
        expectedHash
      );
      if (result.ok) {
        return { ok: true, hash: result.hash };
      }
      return { ok: false, error: result.error };
    },
    [slug]
  );

  const deleteFile = useCallback(
    async (path: string) => {
      const result = await deleteWorkspaceFileAction(slug, path);
      return result.ok;
    },
    [slug]
  );

  const applyPatch = useCallback(
    async (patch: string) => {
      const result = await applyWorkspacePatchAction(slug, patch);
      return result.ok;
    },
    [slug]
  );

  const discardFileChanges = useCallback(
    async (path: string) => {
      try {
        const result = await discardWorkspaceFileChangesAction(slug, path);
        return result;
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "discard_failed",
        };
      }
    },
    [slug]
  );

  // Load sessions
  const loadSessions = useCallback(async () => {
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
        setSessions(result.sessions);
        const sessions = result.sessions;
        const sessionIds = new Set(sessions.map((session) => session.id));
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
          setMessages([]);
        }
      }
    } finally {
      setIsLoadingSessions(false);
    }
  }, [activeSessionStorageKey, slug]);

  const abortActiveStream = useCallback(() => {
    if (activeStreamRef.current) {
      activeStreamRef.current.abortController.abort();
      activeStreamRef.current = null;
      streamCounterRef.current += 1;
      setIsSending(false);
      isSendingRef.current = false;
    }
  }, []);

  // Select session
  const selectSession = useCallback(
    (id: string) => {
      abortActiveStream();
      setActiveSessionId(id);
      activeSessionIdRef.current = id; // Sync ref immediately so in-flight refreshMessages can detect staleness
      setMessages([]); // Clear messages when switching sessions
      resetSessionSelectionState();
    },
    [abortActiveStream, resetSessionSelectionState]
  );

  // Create session
  const createSession = useCallback(
    async (title?: string) => {
      const result = await createSessionAction(slug, title);
      if (result.ok && result.session) {
        setSessions((prev) => [result.session!, ...prev]);
        setActiveSessionId(result.session.id);
        activeSessionIdRef.current = result.session.id; // Sync ref immediately so in-flight refreshMessages can detect staleness
        setMessages([]);
        resetSessionSelectionState();
        return result.session;
      }
      return null;
    },
    [resetSessionSelectionState, slug]
  );

  // Delete session
  const deleteSession = useCallback(
    async (id: string) => {
      const result = await deleteSessionAction(slug, id);
      if (result.ok) {
        setSessions((prev) => {
          const filtered = prev.filter((s) => s.id !== id);
          // Select another session if the deleted one was active
          if (activeSessionId === id && filtered.length > 0) {
            setActiveSessionId(filtered[0].id);
          } else if (filtered.length === 0) {
            setActiveSessionId(null);
          }
          return filtered;
        });
        return true;
      }
      return false;
    },
    [slug, activeSessionId]
  );

  // Rename session
  const renameSession = useCallback(
    async (id: string, title: string) => {
      const result = await updateSessionAction(slug, id, title);
      if (result.ok && result.session) {
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? result.session! : s))
        );
        return true;
      }
      return false;
    },
    [slug]
  );

  // Load messages for active session
  const refreshMessages = useCallback(async () => {
    if (!activeSessionId) {
      console.log(
        "[useWorkspace] refreshMessages: no activeSessionId, skipping"
      );
      return;
    }

    // Don't refresh if we're currently sending a message (use ref to avoid dependency)
    if (isSendingRef.current) {
      console.log(
        "[useWorkspace] refreshMessages: skipping, currently sending"
      );
      return;
    }

    const targetSessionId = activeSessionId;

    console.log(
      "[useWorkspace] refreshMessages: loading for session",
      targetSessionId
    );
    setIsLoadingMessages(true);
    try {
      const result = await listMessagesAction(slug, targetSessionId);

      // If the active session changed while the request was in flight,
      // discard this result to avoid overwriting messages from the new session.
      if (activeSessionIdRef.current !== targetSessionId) return;

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

        setMessages(hydratedMessages);

        const runtime = extractRuntimeMetadata(hydratedMessages);
        if (runtime.agentId) {
          syncActiveAgentFromRuntime(runtime.agentId);
        } else {
          setActiveAgentId(primaryAgent?.id ?? null);
        }
        if (runtime.model) {
          syncRuntimeSelectedModel(runtime.model.providerId, runtime.model.modelId);
        } else {
          setRuntimeSelectedModel(null);
        }
      }
    } finally {
      setIsLoadingMessages(false);
    }
  }, [
    slug,
    activeSessionId,
    extractRuntimeMetadata,
    primaryAgent,
    syncActiveAgentFromRuntime,
    syncRuntimeSelectedModel,
  ]);

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
          ? `to ${taskAgent}${stateTitle ? ` - ${stateTitle}` : ""}`
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
    (messageId: string, part: MessagePart) => {
      setMessages((prev) =>
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
    [deriveStatusInfoFromPart]
  );

  const scheduleWorkspaceRefresh = useCallback(() => {
    if (workspaceRefreshTimeoutRef.current) return;

    workspaceRefreshTimeoutRef.current = setTimeout(() => {
      workspaceRefreshTimeoutRef.current = null;
      setDiffsRefreshTrigger((prev) => prev + 1);
      setFilesRefreshTrigger((prev) => prev + 1);
    }, 250);
  }, []);

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
      abortActiveStream();

      const token = streamCounterRef.current + 1;
      streamCounterRef.current = token;
      const abortController = new AbortController();
      activeStreamRef.current = {
        token,
        sessionId,
        mode,
        targetMessageId,
        abortController,
      };

      setIsSending(true);
      isSendingRef.current = true;

      if (mode === "resume") {
        setMessages((prev) =>
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
      let streamCompleted = false;
      let receivedAssistantPart = false;
      let receivedStreamData = false;

      const flushBufferedParts = (messageId: string) => {
        const buffered = bufferedParts.get(messageId);
        if (!buffered || buffered.length === 0) return;
        receivedAssistantPart = true;
        buffered.forEach((part) => upsertMessagePart(targetMessageId, part));
        bufferedParts.delete(messageId);
      };

      const handlePartUpdate = (part: unknown, messageId?: string) => {
        if (!messageId) return;
        const transformed = transformParts([part]);
        if (transformed.length === 0) return;

        if (mode === "resume") {
          if (messageId !== targetMessageId) return;
          receivedAssistantPart = true;
          transformed.forEach((p) => upsertMessagePart(targetMessageId, p));
          return;
        }

        if (assistantMessageId) {
          if (messageId !== assistantMessageId) return;
          receivedAssistantPart = true;
          transformed.forEach((p) => upsertMessagePart(targetMessageId, p));
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
        setMessages((prev) =>
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

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let eventType = "";
          let eventData = "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              eventData = line.slice(5).trim();
            } else if (line === "" && eventData) {
              try {
                receivedStreamData = true;
                const data = JSON.parse(eventData);

                switch (eventType) {
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
                    if (
                      typeof data.providerID === "string" &&
                      typeof data.modelID === "string"
                    ) {
                      syncRuntimeSelectedModel(data.providerID, data.modelID);
                    }
                    if (typeof data.agent === "string") {
                      syncActiveAgentFromRuntime(data.agent);
                    }
                    break;
                  }

                  case "agent": {
                    if (typeof data.agent === "string") {
                      syncActiveAgentFromRuntime(data.agent);
                    }
                    break;
                  }

                  case "part": {
                    if (!data.part) break;
                    const messageId = data.messageId ?? data.part?.messageID;
                    handlePartUpdate(data.part, messageId);
                    break;
                  }

                  case "workspace-updated": {
                    scheduleWorkspaceRefresh();
                    break;
                  }

                  case "done": {
                    streamCompleted = true;
                    break;
                  }

                  case "error": {
                    updateStatus("error", undefined, data.error);
                    streamCompleted = true;
                    break;
                  }
                }
              } catch {
                // Invalid JSON, skip
              }

              eventType = "";
              eventData = "";
            }
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error("[useWorkspace] Streaming error:", error);
        updateStatus(
          "error",
          undefined,
          error instanceof Error ? error.message : "Unknown error"
        );
      } finally {
        const isLatest = streamCounterRef.current === token;

        if (mode === "resume") {
          if (streamCompleted || receivedAssistantPart) {
            resumeFailureStateRef.current.delete(targetMessageId);
          } else {
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

        if (isLatest) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          const loadLatestMessages = async () => {
            const attempts =
              mode === "send" && assistantMessageId ? 3 : 1;
            let latestResult = await listMessagesAction(slug, sessionId);

            for (let attempt = 1; attempt < attempts; attempt += 1) {
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

              await new Promise((resolve) => setTimeout(resolve, 120));
              latestResult = await listMessagesAction(slug, sessionId);
            }

            return latestResult;
          };

          const result = await loadLatestMessages();
          if (result.ok && result.messages) {
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
                    statusInfo: { status: "error", detail: "stream_incomplete" },
                  };
                });
              }
            }

            setMessages(hydratedMessages);
          } else {
            if (mode === "send" && !receivedStreamData) {
              setMessages((prev) =>
                prev.filter((message) => !message.id.startsWith("temp-"))
              );
            }

            if (!streamCompleted && !receivedAssistantPart) {
              updateStatus("error", undefined, "stream_incomplete");
            }
          }
          scheduleWorkspaceRefresh();
        }

        if (isLatest) {
          setIsSending(false);
          isSendingRef.current = false;
          activeStreamRef.current = null;
        }
      }
    },
    [
      abortActiveStream,
      slug,
      upsertMessagePart,
      syncActiveAgentFromRuntime,
      syncRuntimeSelectedModel,
      scheduleWorkspaceRefresh,
    ]
  );

  // Send message with SSE streaming
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
        activeSessionId,
        options,
      });

      if (isSendingRef.current) return;

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

      let sessionId = activeSessionId;
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

      if (!sessionId) return;

      let resolvedModel = model;
      if (!resolvedModel) {
        if (manualSelectedModel) {
          resolvedModel = {
            providerId: manualSelectedModel.providerId,
            modelId: manualSelectedModel.modelId,
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

      abortActiveStream();
      setMessages((prev) => [...prev, tempUserMsg, tempAssistantMsg]);
      await streamChat({
        sessionId,
        mode: "send",
        targetMessageId: tempAssistantMsgId,
        text,
        model: resolvedModel,
        attachments: messageAttachments,
        contextPaths: messageContextPaths,
      });
    },
    [
      abortActiveStream,
      activeSessionId,
      createSession,
      manualSelectedModel,
      streamChat,
    ]
  );

  // Abort session
  const abortSession = useCallback(async () => {
    if (!activeSessionId) return;
    abortActiveStream();
    await abortSessionAction(slug, activeSessionId);
  }, [abortActiveStream, slug, activeSessionId]);

  // Load diffs
  const refreshDiffs = useCallback(async (options?: { force?: boolean }) => {
    if (!enabled) return;
    if (!options?.force && !isConnected) return;

    // Avoid overlapping refreshes (interval + manual triggers)
    if (isLoadingDiffsRef.current) return;

    setIsLoadingDiffs(true);
    isLoadingDiffsRef.current = true;
    try {
      console.log("[useWorkspace] refreshDiffs: loading...");
      const result = await getWorkspaceDiffsAction(slug);
      if (result.ok && result.diffs) {
        setDiffs(result.diffs);
        setDiffsError(null);
        console.log(
          "[useWorkspace] refreshDiffs result:",
          true,
          "diffs:",
          result.diffs.length
        );
      } else {
        const err = result.error ?? "unknown";
        setDiffsError(err);
        console.log(
          "[useWorkspace] refreshDiffs result:",
          false,
          "error:",
          err
        );
      }
    } finally {
      setIsLoadingDiffs(false);
      isLoadingDiffsRef.current = false;
    }
  }, [slug, enabled, isConnected]);

  // Load models
  const loadModels = useCallback(async () => {
    const result = await listModelsAction(slug);
    if (!result.ok || !result.models) return;

    let nextModels = result.models;

    // Defense in depth: filter providers based on server credential status.
    // (This prevents UI showing providers without keys even if OpenCode lists them.)
    try {
      const response = await fetch(`/api/u/${slug}/providers`, {
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as {
          providers?: Array<{ providerId: ProviderId; status: string }>;
        };
        const enabled = new Set(
          (data.providers ?? [])
            .filter((p) => p.status === "enabled")
            .map((p) => p.providerId)
        );

        nextModels = nextModels.filter((m) => {
          if (!PROVIDERS.includes(m.providerId as ProviderId)) return true;
          return enabled.has(m.providerId as ProviderId);
        });
      }
    } catch {
      // ignore — fall back to server action list
    }

    setModels(nextModels);

    setManualSelectedModel((current) => {
      if (!current) return null;
      if (!hasModelEntry(current.providerId, current.modelId, nextModels)) {
        return null;
      }
      return resolveModelEntry(current.providerId, current.modelId, nextModels);
    });
    setRuntimeSelectedModel((current) => {
      if (!current) return null;
      return resolveModelEntry(current.providerId, current.modelId, nextModels);
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
      setActiveAgentId((current) => {
        if (current) {
          const resolvedCurrent = findAgentInCatalog(agents, current);
          if (resolvedCurrent) {
            return resolvedCurrent.id;
          }
        }
        return primary?.id ?? current;
      });
    } catch {
      // keep defaults when catalog is unavailable
    }
  }, [slug]);

  // Initial load when connected - with retry on failure
  useEffect(() => {
    if (!enabled) {
      setConnection({ status: "connecting" });
      return;
    }

    let mounted = true;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    const MAX_RETRIES = 10;
    const BASE_DELAY = 1000;

    async function init() {
      const connected = await checkConnection();
      if (!mounted) return;

      if (connected) {
        retryCount = 0; // Reset on success
        // Load initial data in parallel
        await Promise.all([
          refreshFiles(),
          loadSessions(),
          loadModels(),
          loadAgentCatalog(),
          refreshDiffs({ force: true }),
        ]);
      } else if (retryCount < MAX_RETRIES) {
        // Retry with exponential backoff (1s, 2s, 4s, 8s... capped at 30s)
        retryCount++;
        const delay = Math.min(BASE_DELAY * Math.pow(2, retryCount - 1), 30000);
        console.log(
          `[useWorkspace] Connection failed, retrying in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES})`
        );
        retryTimeout = setTimeout(() => {
          if (mounted) init();
        }, delay);
      } else {
        console.log("[useWorkspace] Max retries reached, giving up");
      }
    }

    init();

    return () => {
      mounted = false;
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [
    checkConnection,
    refreshFiles,
    loadSessions,
    loadModels,
    loadAgentCatalog,
    refreshDiffs,
    enabled,
  ]);

  // Load messages when active session changes
  useEffect(() => {
    persistActiveSessionId(activeSessionStorageKey, activeSessionId);
  }, [activeSessionId, activeSessionStorageKey]);

  useEffect(() => {
    console.log(
      "[useWorkspace] activeSessionId changed:",
      activeSessionId,
      "isConnected:",
      isConnected
    );
    if (activeSessionId && isConnected) {
      refreshMessages();
    }
  }, [activeSessionId, isConnected, refreshMessages]);

  useEffect(() => {
    if (!activeSessionId || !isConnected) return;
    if (isSendingRef.current) return;

    const now = Date.now();
    const sessionBusy = activeSession?.status === "busy";

    const stalePendingWithoutParts = [...messages].reverse().find((m) => {
      if (m.role !== "assistant" || !m.pending) return false;
      if (m.parts.length > 0) return false;
      if (typeof m.timestampRaw !== "number") return false;
      return now - m.timestampRaw >= STALE_PENDING_ASSISTANT_MS;
    });

    if (stalePendingWithoutParts && !sessionBusy) {
      setMessages((prev) =>
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

    const pendingAssistant = [...messages]
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

      const activeStream = activeStreamRef.current;
      if (
        !activeStream ||
        activeStream.sessionId !== activeSessionId ||
        activeStream.mode !== "resume"
      ) {
        streamChat({
          sessionId: activeSessionId,
          mode: "resume",
          targetMessageId: pendingAssistant.id,
        });
      }
      return;
    }

    const activeStream = activeStreamRef.current;
    if (
      activeStream &&
      activeStream.sessionId === activeSessionId &&
      activeStream.mode === "resume"
    ) {
      abortActiveStream();
    }
  }, [
    abortActiveStream,
    activeSession?.status,
    activeSessionId,
    isConnected,
    messages,
    streamChat,
  ]);

  // Refresh diffs when triggered by message completion
  useEffect(() => {
    if (diffsRefreshTrigger > 0 && isConnected) {
      refreshDiffs();
    }
  }, [diffsRefreshTrigger, isConnected, refreshDiffs]);

  useEffect(() => {
    if (filesRefreshTrigger > 0 && isConnected) {
      refreshFiles();
    }
  }, [filesRefreshTrigger, isConnected, refreshFiles]);

  // Keep the workspace instance alive while this tab remains open.
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const heartbeat = async () => {
      try {
        await fetch(`/api/instances/${slug}/activity`, {
          method: "PATCH",
          cache: "no-store",
        });
      } catch {
        // best-effort
      }
    };

    void heartbeat();

    const interval = setInterval(() => {
      if (cancelled) return;
      void heartbeat();
    }, INSTANCE_ACTIVITY_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, slug]);

  // Poll for session status updates
  useEffect(() => {
    if (!isConnected || pollInterval <= 0) return;

    const interval = setInterval(() => {
      loadSessions();
      refreshDiffs();
    }, pollInterval);

    return () => clearInterval(interval);
  }, [isConnected, pollInterval, loadSessions, refreshDiffs]);

  useEffect(() => {
    return () => {
      if (workspaceRefreshTimeoutRef.current) {
        clearTimeout(workspaceRefreshTimeoutRef.current);
        workspaceRefreshTimeoutRef.current = null;
      }
      abortActiveStream();
    };
  }, [abortActiveStream]);

  return {
    connection,
    isConnected,
    fileTree,
    isLoadingFiles,
    refreshFiles,
    readFile,
    writeFile,
    deleteFile,
    applyPatch,
    discardFileChanges,
    sessions,
    activeSessionId,
    activeSession,
    isLoadingSessions,
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
    diffs,
    isLoadingDiffs,
    diffsError,
    refreshDiffs,
    models,
    agentDefaultModel,
    selectedModel,
    hasManualModelSelection,
    setSelectedModel: updateSelectedModel,
    activeAgentName,
    agentCatalog,
  };
}

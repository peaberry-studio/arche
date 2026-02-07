"use client";

import { useCallback, useEffect, useState, useRef } from "react";
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
  ) => Promise<{ content: string; type: "raw" | "patch" } | null>;
  writeFile: (
    path: string,
    content: string,
    expectedHash?: string
  ) => Promise<{ ok: boolean; hash?: string }>;
  deleteFile: (path: string) => Promise<boolean>;
  applyPatch: (patch: string) => Promise<boolean>;

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
  sendMessage: (
    text: string,
    model?: { providerId: string; modelId: string }
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
  selectedModel: AvailableModel | null;
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
  const isSendingRef = useRef(false); // Ref to track sending state without causing re-renders
  const streamCounterRef = useRef(0);
  const activeStreamRef = useRef<{
    token: number;
    sessionId: string;
    mode: "send" | "resume";
    targetMessageId: string;
    abortController: AbortController;
  } | null>(null);

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
  const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(
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

  const syncSelectedModel = useCallback(
    (providerId?: string, modelId?: string) => {
      if (!providerId || !modelId) return;

      setSelectedModel((current) => {
        if (
          current?.providerId === providerId &&
          current?.modelId === modelId
        ) {
          return current;
        }

        const found = models.find(
          (entry) =>
            entry.providerId === providerId && entry.modelId === modelId
        );
        if (found) return found;

        return {
          providerId,
          modelId,
          providerName: providerId,
          modelName: modelId,
          isDefault: false,
        };
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
      return { ok: false };
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

        // Auto-select first session if none selected
        // Use functional update to avoid dependency on activeSessionId
        const sessions = result.sessions;
        setActiveSessionId((prev) => {
          if (!prev && sessions.length > 0) {
            console.log(
              "[useWorkspace] Auto-selecting first session:",
              sessions[0].id
            );
            return sessions[0].id;
          }
          return prev;
        });
      }
    } finally {
      setIsLoadingSessions(false);
    }
  }, [slug]);

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
      setMessages([]); // Clear messages when switching sessions
    },
    [abortActiveStream]
  );

  // Create session
  const createSession = useCallback(
    async (title?: string) => {
      const result = await createSessionAction(slug, title);
      if (result.ok && result.session) {
        setSessions((prev) => [result.session!, ...prev]);
        setActiveSessionId(result.session.id);
        setMessages([]);
        return result.session;
      }
      return null;
    },
    [slug]
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

    console.log(
      "[useWorkspace] refreshMessages: loading for session",
      activeSessionId
    );
    setIsLoadingMessages(true);
    try {
      const result = await listMessagesAction(slug, activeSessionId);
      console.log(
        "[useWorkspace] refreshMessages result:",
        result.ok,
        "messages:",
        result.messages?.length
      );
      if (result.ok && result.messages) {
        setMessages(result.messages);

        const runtime = extractRuntimeMetadata(result.messages);
        if (runtime.agentId) {
          syncActiveAgentFromRuntime(runtime.agentId);
        }
        if (runtime.model) {
          syncSelectedModel(runtime.model.providerId, runtime.model.modelId);
        }
      }
    } finally {
      setIsLoadingMessages(false);
    }
  }, [
    slug,
    activeSessionId,
    extractRuntimeMetadata,
    syncActiveAgentFromRuntime,
    syncSelectedModel,
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
  };

  const streamChat = useCallback(
    async ({
      sessionId,
      mode,
      targetMessageId,
      text,
      model,
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
      let receivedAnyPart = false;

      const flushBufferedParts = (messageId: string) => {
        const buffered = bufferedParts.get(messageId);
        if (!buffered || buffered.length === 0) return;
        buffered.forEach((part) => upsertMessagePart(targetMessageId, part));
        bufferedParts.delete(messageId);
      };

      const handlePartUpdate = (part: unknown, messageId?: string) => {
        if (!messageId) return;
        const transformed = transformParts([part]);
        if (transformed.length === 0) return;
        receivedAnyPart = true;

        if (mode === "resume") {
          if (messageId !== targetMessageId) return;
          transformed.forEach((p) => upsertMessagePart(targetMessageId, p));
          return;
        }

        if (assistantMessageId) {
          if (messageId !== assistantMessageId) return;
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
                      syncSelectedModel(data.providerID, data.modelID);
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

        if (isLatest && (streamCompleted || receivedAnyPart)) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          const result = await listMessagesAction(slug, sessionId);
          if (result.ok && result.messages) {
            setMessages(result.messages);
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
      syncSelectedModel,
      scheduleWorkspaceRefresh,
    ]
  );

  // Send message with SSE streaming
  const sendMessage = useCallback(
    async (text: string, model?: { providerId: string; modelId: string }) => {
      console.log("[useWorkspace] sendMessage called", {
        text,
        model,
        activeSessionId,
      });

      if (isSendingRef.current) return;

      // Auto-create session if none exists
      let sessionId = activeSessionId;
      if (!sessionId) {
        console.log("[useWorkspace] No activeSessionId, creating new session");
        const newSession = await createSession();
        if (!newSession) {
          console.log("[useWorkspace] Failed to create session");
          return;
        }
        sessionId = newSession.id;
      }

      // Add optimistic user message
      const tempUserMsgId = `temp-user-${Date.now()}`;
      const tempUserMsg: WorkspaceMessage = {
        id: tempUserMsgId,
        sessionId: sessionId,
        role: "user",
        content: text,
        timestamp: "Just now",
        parts: [{ type: "text", text }],
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
        model,
      });
    },
    [abortActiveStream, activeSessionId, createSession, streamChat]
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

    setSelectedModel((current) => {
      const stillSelected =
        current &&
        nextModels.some(
          (m) =>
            m.providerId === current.providerId && m.modelId === current.modelId
        );

      if (stillSelected) {
        return current;
      }

      return nextModels.find((m) => m.isDefault) ?? null;
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

      setAgentCatalog(agents);
      setActiveAgentId((current) => {
        if (current) {
          const resolvedCurrent = findAgentInCatalog(agents, current);
          if (resolvedCurrent) {
            return resolvedCurrent.id;
          }
        }
        const primary = agents.find((agent) => agent.isPrimary);
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

    const pendingAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.pending);
    if (pendingAssistant) {
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
  }, [abortActiveStream, activeSessionId, isConnected, messages, streamChat]);

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
    sendMessage,
    abortSession,
    refreshMessages,
    diffs,
    isLoadingDiffs,
    diffsError,
    refreshDiffs,
    models,
    selectedModel,
    setSelectedModel,
    activeAgentName,
    agentCatalog,
  };
}

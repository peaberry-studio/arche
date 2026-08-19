"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type SetStateAction } from "react";

import { listMessagesAction } from "@/actions/opencode";
import type {
  MessagePart,
  MessageStatus,
  PermissionState,
  WorkspaceMessage,
  WorkspaceSession,
} from "@/lib/opencode/types";
import { extractTextContent, transformParts } from "@/lib/opencode/transform";
import { isRecord } from "@/lib/records";
import { INITIAL_SSE_PARSE_STATE, parseSseChunk } from "@/lib/sse-parser";
import {
  recordResumeFailure,
  type ResumeFailureState,
} from "@/lib/workspace-resume-policy";
import {
  RESUME_POLL_INTERVAL_MS,
  applyDeltaToPart,
  getString,
  toPermissionPart,
} from "@/hooks/workspace/workspace-types";

type UseWorkspaceStreamingOptions = {
  slug: string;
  updateSessionMessages: (
    sessionId: string,
    updater: SetStateAction<WorkspaceMessage[]>
  ) => void;
  syncRuntimeSelectedModel: (sessionId: string, providerId?: string, modelId?: string) => void;
  syncActiveAgentFromRuntime: (sessionId: string, agentId: string) => void;
  syncRuntimeMetadataForSession: (sessionId: string, items: WorkspaceMessage[]) => void;
  refreshDiffs: () => void;
  refreshFiles: () => Promise<void>;
  getActiveSessionId: () => string | null;
  getSessions: () => WorkspaceSession[];
  onBackgroundStreamCompleted: (sessionId: string) => void;
  resumeFailureStateRef: MutableRefObject<Map<string, ResumeFailureState>>;
};

type ListMessagesResult = Awaited<ReturnType<typeof listMessagesAction>>;

export type StreamReconciliationInput = {
  mode: "send" | "resume";
  assistantMessageId: string | null;
  targetMessageId: string;
  receivedAssistantPart: boolean;
  receivedStreamData: boolean;
  interruptionDetail?: string | null;
  terminalErrorDetail: string | null;
  result: ListMessagesResult;
  resumeFailureState: Map<string, ResumeFailureState>;
};

export type StreamReconciliationResult =
  | { action: "hydrate"; messages: WorkspaceMessage[] }
  | { action: "fallback-error"; messageId: string; detail: string }
  | { action: "stream-incomplete"; detail: string }
  | { action: "stream-interrupted"; detail: string }
  | { action: "none" };

const STREAM_RECONCILIATION_DELAY_MS = 250;
const STREAM_RECOVERY_BASE_DELAY_MS = 1_000;
const STREAM_RECOVERY_MAX_DELAY_MS = 30_000;

type StreamMode = "send" | "resume";
type StreamOptions = {
  sessionId: string;
  mode: StreamMode;
  targetMessageId: string;
  runId?: string;
  text?: string;
  model?: { providerId: string; modelId: string };
  attachments?: { path: string; filename?: string; mime?: string }[];
  contextPaths?: string[];
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadLatestMessagesWithRetry({
  slug,
  sessionId,
  mode,
  assistantMessageId,
}: {
  slug: string;
  sessionId: string;
  mode: "send" | "resume";
  assistantMessageId: string | null;
}): Promise<ListMessagesResult> {
  const maxAttempts = mode === "send" && assistantMessageId ? 5 : 1;
  let latestResult = await listMessagesAction(slug, sessionId);

  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    if (!latestResult.ok || !latestResult.messages) {
      return latestResult;
    }

    const assistant = latestResult.messages.find(
      (message) =>
        message.id === assistantMessageId && message.role === "assistant"
    );

    if (assistant) {
      return latestResult;
    }

    await delay(250 * Math.pow(2, attempt - 1));
    latestResult = await listMessagesAction(slug, sessionId);
  }

  return latestResult;
}

export function reconcileStreamMessages({
  mode,
  assistantMessageId,
  targetMessageId,
  receivedAssistantPart,
  receivedStreamData,
  interruptionDetail,
  terminalErrorDetail,
  result,
  resumeFailureState,
}: StreamReconciliationInput): StreamReconciliationResult {
  if (!result.ok || !result.messages) {
    if (interruptionDetail) {
      return { action: "stream-interrupted", detail: interruptionDetail };
    }
    if (!terminalErrorDetail && receivedAssistantPart) return { action: "none" };
    return {
      action: "stream-incomplete",
      detail: terminalErrorDetail ?? "stream_incomplete",
    };
  }

  const pendingIds = new Set(
    result.messages.filter((message) => message.pending).map((message) => message.id)
  );
  for (const [messageId] of resumeFailureState) {
    if (!pendingIds.has(messageId)) {
      resumeFailureState.delete(messageId);
    }
  }

  let hydratedMessages: WorkspaceMessage[] = result.messages.map(
    (message): WorkspaceMessage => {
      const resumeState = resumeFailureState.get(message.id);
      if (message.role === "assistant" && message.pending && interruptionDetail) {
        return {
          ...message,
          statusInfo: { status: "thinking", detail: interruptionDetail },
        };
      }
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

  if (interruptionDetail && hydratedMessages.length === 0) {
    return { action: "stream-interrupted", detail: interruptionDetail };
  }

  if (mode === "send" && assistantMessageId && !receivedAssistantPart) {
    const assistantMessage = hydratedMessages.find(
      (message) =>
        message.id === assistantMessageId && message.role === "assistant"
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
    return {
      action: "fallback-error",
      messageId: assistantMessageId ?? targetMessageId,
      detail: terminalErrorDetail,
    };
  }

  if (mode === "send" && terminalErrorDetail && !assistantMessageId) {
    return {
      action: "fallback-error",
      messageId: targetMessageId,
      detail: terminalErrorDetail,
    };
  }

  return { action: "hydrate", messages: hydratedMessages };
}

export function useWorkspaceStreaming({
  slug,
  updateSessionMessages,
  syncRuntimeSelectedModel,
  syncActiveAgentFromRuntime,
  syncRuntimeMetadataForSession,
  refreshDiffs,
  refreshFiles,
  getActiveSessionId,
  getSessions,
  onBackgroundStreamCompleted,
  resumeFailureStateRef,
}: UseWorkspaceStreamingOptions) {
  const [sessionStreamStatus, setSessionStreamStatus] = useState<
    Record<string, "submitted" | "streaming" | "error">
  >({});
  const [isStartingNewSession, setIsStartingNewSession] = useState(false);

  const sessionStreamStatusRef = useRef<
    Record<string, "submitted" | "streaming" | "error">
  >({});
  const streamCounterRef = useRef(0);
  const activeStreamsRef = useRef(new Map<string, {
    token: number;
    sessionId: string;
    mode: "send" | "resume";
    targetMessageId: string;
    abortController: AbortController;
  }>());
  const latestStreamTokensRef = useRef(new Map<string, number>());
  const recoveryAttemptsRef = useRef(new Map<string, number>());
  const recoveryTimeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const streamChatRef = useRef<((options: StreamOptions) => Promise<void>) | null>(null);
  const isMountedRef = useRef(true);
  const workspaceRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSessionIdGetterRef = useRef(getActiveSessionId);
  const sessionsGetterRef = useRef(getSessions);

  useEffect(() => {
    activeSessionIdGetterRef.current = getActiveSessionId;
  }, [getActiveSessionId]);

  useEffect(() => {
    sessionsGetterRef.current = getSessions;
  }, [getSessions]);

  const setSessionStreamStatusTo = useCallback(
    (
      sessionId: string,
      status: "submitted" | "streaming" | "error" | "ready",
      notifyBackgroundCompletion = true
    ) => {
      setSessionStreamStatus((prev) => {
        if (status === "ready") {
          if (!(sessionId in prev)) return prev;

          const wasStreaming = prev[sessionId] === "submitted" || prev[sessionId] === "streaming";
          if (
            notifyBackgroundCompletion &&
            wasStreaming &&
            sessionId !== activeSessionIdGetterRef.current()
          ) {
            onBackgroundStreamCompleted(sessionId);
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
    [onBackgroundStreamCompleted]
  );

  const abortSessionStream = useCallback(
    (sessionId: string) => {
      const recoveryTimeout = recoveryTimeoutsRef.current.get(sessionId);
      if (recoveryTimeout) {
        clearTimeout(recoveryTimeout);
        recoveryTimeoutsRef.current.delete(sessionId);
      }

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
    for (const recoveryTimeout of recoveryTimeoutsRef.current.values()) {
      clearTimeout(recoveryTimeout);
    }
    recoveryTimeoutsRef.current.clear();
    recoveryAttemptsRef.current.clear();

    for (const sessionId of activeStreamsRef.current.keys()) {
      const activeStream = activeStreamsRef.current.get(sessionId);
      activeStream?.abortController.abort();
      latestStreamTokensRef.current.delete(sessionId);
      setSessionStreamStatusTo(sessionId, "ready");
    }
    activeStreamsRef.current.clear();
    streamCounterRef.current += 1;
  }, [setSessionStreamStatusTo]);

  const resetSessions = useCallback(
    (sessionIds: Set<string>) => {
      for (const sessionId of sessionIds) {
        abortSessionStream(sessionId);
        setSessionStreamStatusTo(sessionId, "ready");
      }
    },
    [abortSessionStream, setSessionStreamStatusTo]
  );

  const scheduleWorkspaceRefresh = useCallback(() => {
    if (workspaceRefreshTimeoutRef.current) return;

    workspaceRefreshTimeoutRef.current = setTimeout(() => {
      workspaceRefreshTimeoutRef.current = null;
      refreshDiffs();
      void refreshFiles();
    }, 250);
  }, [refreshDiffs, refreshFiles]);

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
      case "permission": {
        if (part.state === "pending") {
          const metadataTool =
            typeof part.metadata?.tool === "string" && part.metadata.tool.trim()
              ? part.metadata.tool
              : typeof part.metadata?.toolName === "string" && part.metadata.toolName.trim()
                ? part.metadata.toolName
                : part.pattern;
          return {
            status: "tool-calling" as const,
            toolName: metadataTool,
            detail: "permission_required",
          };
        }
        return { status: "thinking" as const };
      }
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

  const streamChat = useCallback(
    async ({
      sessionId,
      mode,
      targetMessageId,
      runId: existingRunId,
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
      let observedRunId = existingRunId ?? null;
      const bufferedParts = new Map<string, MessagePart[]>();
      const textAccumulatorByPart = new Map<string, string>();
      let streamCompleted = false;
      let streamResponseOpened = false;
      let receivedAssistantPart = false;
      let receivedStreamData = false;
      let interruptionDetail: string | null = null;
      let terminalErrorDetail: string | null = null;
      let livePollInterval: ReturnType<typeof setInterval> | null = null;

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

      const handlePermissionUpdate = (data: unknown) => {
        const part = toPermissionPart(data);
        if (!part) return;

        receivedAssistantPart = true;
        upsertMessagePart(sessionId, targetMessageId, part);
      };

      const handlePermissionReply = (data: unknown) => {
        if (!isRecord(data)) return;

        const permissionId = getString(data.id);
        if (!permissionId) return;

        const state: PermissionState = data.response === "reject" ? "rejected" : "approved";
        updateSessionMessages(sessionId, (prev) =>
          prev.map((message) => {
            if (message.id !== targetMessageId) return message;

            const parts = message.parts.map((part) =>
              part.type === "permission" && part.permissionId === permissionId
                ? { ...part, state }
                : part
            );
            const stillWaiting = parts.some(
              (part) => part.type === "permission" && part.state === "pending"
            );

            return {
              ...message,
              parts,
              statusInfo: stillWaiting
                ? message.statusInfo
                : message.statusInfo?.detail === "permission_required"
                  ? { status: "thinking" }
                  : message.statusInfo,
            };
          })
        );
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
            ...(observedRunId ? { runId: observedRunId } : {}),
            resume: mode === "resume",
            messageId: mode === "resume" ? targetMessageId : undefined,
            ...(mode === "send" && !observedRunId
              ? { text, model, attachments, contextPaths }
              : {}),
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: "Failed to send message" }));
          throw new Error(error.error || "Failed to send message");
        }

        streamResponseOpened = true;
        observedRunId = response.headers?.get("X-Arche-Run-Id") || observedRunId;

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        // Poll the message API while the SSE is open so we still surface
        // later parts and permission cards when events arrive on a child
        // session, or when the live reader goes quiet after an approval.
        livePollInterval = setInterval(async () => {
          try {
            const poll = await listMessagesAction(slug, sessionId);
            if (!poll.ok || !poll.messages) return;

            const observedId =
              assistantMessageId ?? (mode === "resume" ? targetMessageId : null);
            const polledAssistant = observedId
              ? poll.messages.find((message) => message.id === observedId)
              : [...poll.messages].reverse().find((message) => message.role === "assistant");
            if (!polledAssistant) return;

            if (mode === "resume" && !polledAssistant.pending) {
              streamCompleted = true;
              updateSessionMessages(sessionId, poll.messages);
              syncRuntimeMetadataForSession(sessionId, poll.messages);
              abortController.abort();
              return;
            }

            polledAssistant.parts.forEach((part) => {
              upsertMessagePart(sessionId, targetMessageId, part);
            });
          } catch {
            // Ignore individual poll errors
          }
        }, RESUME_POLL_INTERVAL_MS);

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

              if (
                parsedEvent.event !== "error" &&
                parsedEvent.event !== "status"
              ) {
                recoveryAttemptsRef.current.delete(sessionId);
              }

              switch (parsedEvent.event) {
                case "status": {
                  const status = data.status as MessageStatus;
                  updateStatus(status, data.toolName, data.detail);
                  if (status === "complete" || status === "error") {
                    recoveryAttemptsRef.current.delete(sessionId);
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

                case "permission": {
                  handlePermissionUpdate(data);
                  break;
                }

                case "permission-replied": {
                  handlePermissionReply(data);
                  break;
                }

                case "workspace-updated": {
                  scheduleWorkspaceRefresh();
                  break;
                }

                case "done": {
                  recoveryAttemptsRef.current.delete(sessionId);
                  updateStatus("complete");
                  streamCompleted = true;
                  break;
                }

                case "error": {
                  const detail = typeof data.error === "string" ? data.error : "stream_interrupted";
                  if (data.recoverable === true) {
                    interruptionDetail = detail;
                    if (typeof data.runId === "string") {
                      observedRunId = data.runId;
                    }
                    updateStatus("thinking", undefined, detail);
                  } else {
                    recoveryAttemptsRef.current.delete(sessionId);
                    terminalErrorDetail = detail;
                    updateStatus("error", undefined, detail);
                  }
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

        if (!streamCompleted) {
          interruptionDetail = "stream_interrupted";
          updateStatus("thinking", undefined, interruptionDetail);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error("[useWorkspace] Streaming error:", error);
        const detail = error instanceof Error ? error.message : "Unknown error";
        // A runId-carrying stream only observes an already-accepted run, so a
        // transport failure before the response opens is recoverable: nothing
        // was sent and the run may still be active and reattachable.
        if (streamResponseOpened || observedRunId) {
          interruptionDetail = "stream_interrupted";
          updateStatus("thinking", undefined, interruptionDetail);
        } else {
          terminalErrorDetail = detail;
          updateStatus("error", undefined, terminalErrorDetail);
        }
      } finally {
        if (livePollInterval) {
          clearInterval(livePollInterval);
        }

        const isLatestStream = () => latestStreamTokensRef.current.get(sessionId) === token;

        if (mode === "resume") {
          if (interruptionDetail || streamCompleted || receivedAssistantPart) {
            resumeFailureStateRef.current.delete(targetMessageId);
          } else {
            // If the session is still actively processing, don't record a
            // resume failure -- the auto-resume effect will retry once the
            // pending key is re-evaluated after the next message refresh.
            const sessionStillBusy =
              sessionsGetterRef.current().find((s) => s.id === sessionId)?.status === "busy";

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
            setSessionStreamStatusTo(
              sessionId,
              "ready",
              interruptionDetail === null
            );
          }
        }

        if (isLatestStream() && isMountedRef.current) {
          await delay(STREAM_RECONCILIATION_DELAY_MS);
          if (!isMountedRef.current || !isLatestStream()) {
            return;
          }

          const result = await loadLatestMessagesWithRetry({
            slug,
            sessionId,
            mode,
            assistantMessageId,
          });
          if (!isMountedRef.current || !isLatestStream()) {
            return;
          }

          if (interruptionDetail && result.ok && result.messages) {
            const pendingAssistant = [...result.messages].reverse().find(
              (message) => message.role === "assistant" && message.pending
            );
            if (!assistantMessageId && pendingAssistant) {
              assistantMessageId = pendingAssistant.id;
            }

            const observedAssistantId = assistantMessageId ?? (
              mode === "resume" ? targetMessageId : null
            );
            const observedAssistant = observedAssistantId
              ? result.messages.find((message) => message.id === observedAssistantId)
              : null;
            if (observedAssistant && !observedAssistant.pending) {
              interruptionDetail = null;
            }
          }

          const reconciliation = reconcileStreamMessages({
            mode,
            assistantMessageId,
            targetMessageId,
            receivedAssistantPart,
            receivedStreamData,
            interruptionDetail,
            terminalErrorDetail,
            result,
            resumeFailureState: resumeFailureStateRef.current,
          });

          if (reconciliation.action === "hydrate") {
            updateSessionMessages(sessionId, reconciliation.messages);
            syncRuntimeMetadataForSession(sessionId, reconciliation.messages);
          } else if (reconciliation.action === "fallback-error") {
            updateSessionMessages(sessionId, (prev) =>
              prev.map((message) => {
                if (message.id !== reconciliation.messageId) return message;
                return {
                  ...message,
                  pending: false,
                  statusInfo: { status: "error", detail: reconciliation.detail },
                };
              })
            );
          } else if (
            reconciliation.action === "stream-incomplete" &&
            !streamCompleted &&
            !receivedAssistantPart
          ) {
            updateStatus("error", undefined, reconciliation.detail);
          } else if (reconciliation.action === "stream-interrupted") {
            updateStatus("thinking", undefined, reconciliation.detail);
          }
          scheduleWorkspaceRefresh();

          if (interruptionDetail && isLatestStream() && isMountedRef.current) {
            const attempt = (recoveryAttemptsRef.current.get(sessionId) ?? 0) + 1;
            recoveryAttemptsRef.current.set(sessionId, attempt);
            const recoveryDelay = Math.min(
              STREAM_RECOVERY_BASE_DELAY_MS * Math.pow(2, attempt - 1),
              STREAM_RECOVERY_MAX_DELAY_MS
            );
            const recoveryTargetMessageId = assistantMessageId ?? targetMessageId;
            const recoveryOptions: StreamOptions = observedRunId
              ? {
                  sessionId,
                  mode: "send",
                  targetMessageId: recoveryTargetMessageId,
                  runId: observedRunId,
                }
              : {
                  sessionId,
                  mode: "resume",
                  targetMessageId: recoveryTargetMessageId,
                };

            const recoveryTimeout = setTimeout(() => {
              if (recoveryTimeoutsRef.current.get(sessionId) !== recoveryTimeout) return;
              recoveryTimeoutsRef.current.delete(sessionId);
              if (!isMountedRef.current || activeStreamsRef.current.has(sessionId)) return;
              void streamChatRef.current?.(recoveryOptions);
            }, recoveryDelay);
            recoveryTimeoutsRef.current.set(sessionId, recoveryTimeout);
          }
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
      resumeFailureStateRef,
    ]
  );

  useEffect(() => {
    streamChatRef.current = streamChat;
  }, [streamChat]);

  const isSending = useMemo(() => {
    return Object.values(sessionStreamStatus).some(
      (status) => status === "submitted" || status === "streaming"
    );
  }, [sessionStreamStatus]);

  return {
    sessionStreamStatus,
    sessionStreamStatusRef,
    isStartingNewSession,
    setIsStartingNewSession,
    isSending,
    streamChat,
    abortSessionStream,
    abortAllStreams,
    resetSessions,
    activeStreamsRef,
    isMountedRef,
    workspaceRefreshTimeoutRef,
  };
}

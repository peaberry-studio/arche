"use client";

import { useCallback, type MutableRefObject, type SetStateAction } from "react";

import { abortSessionAction } from "@/actions/opencode";
import type {
  AvailableModel,
  MessagePart,
  PermissionResponse,
  WorkspaceMessage,
  WorkspaceSession,
} from "@/lib/opencode/types";
import {
  PRE_SESSION_SELECTION_KEY,
  type SessionSelectionState,
  type StreamOptions,
} from "@/hooks/workspace/workspace-types";
import type { MessageAttachmentInput } from "@/types/workspace";

type StreamStatus = "submitted" | "streaming" | "error";

type UseWorkspaceMessageActionsOptions = {
  slug: string;
  activeSessionIdRef: MutableRefObject<string | null>;
  activeStreamsRef: MutableRefObject<Map<string, unknown>>;
  agentDefaultModel: AvailableModel | null;
  createSession: (title?: string) => Promise<WorkspaceSession | null>;
  models: AvailableModel[];
  primaryAgentId: string | null;
  refreshWorkspaceMessages: (sessionIdOverride?: string) => Promise<void>;
  sessionSelectionStateRef: MutableRefObject<Record<string, SessionSelectionState>>;
  sessionStreamStatusRef: MutableRefObject<Record<string, StreamStatus>>;
  setIsStartingNewSession: (value: boolean) => void;
  streamChat: (options: StreamOptions) => Promise<void>;
  abortSessionStream: (sessionId: string) => void;
  updateSessionMessages: (
    sessionId: string,
    updater: SetStateAction<WorkspaceMessage[]>
  ) => void;
};

function normalizeAttachments(
  attachments: MessageAttachmentInput[] | undefined
): MessageAttachmentInput[] {
  return (attachments ?? []).filter(
    (attachment) =>
      typeof attachment.path === "string" && attachment.path.trim().length > 0
  );
}

function normalizeContextPaths(contextPaths: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (contextPaths ?? [])
        .filter((path): path is string => typeof path === "string")
        .map((path) => path.trim())
        .filter((path) => path.length > 0)
    )
  );
}

export function useWorkspaceMessageActions({
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
}: UseWorkspaceMessageActionsOptions) {
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
        attachments?: MessageAttachmentInput[];
        contextPaths?: string[];
      }
    ) => {
      const targetSessionId = activeSessionIdRef.current;
      const messageAttachments = normalizeAttachments(options?.attachments);
      const messageContextPaths = normalizeContextPaths(options?.contextPaths);

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
        sessionId,
        role: "user",
        content: text,
        timestamp: "Just now",
        parts: tempUserParts,
        pending: false,
      };

      const tempAssistantMsgId = `temp-assistant-${Date.now()}`;
      const tempAssistantMsg: WorkspaceMessage = {
        id: tempAssistantMsgId,
        sessionId,
        role: "assistant",
        content: "",
        timestamp: "Just now",
        timestampRaw: Date.now(),
        parts: [],
        pending: true,
        statusInfo: { status: "thinking" },
      };

      updateSessionMessages(sessionId, (prev) => [
        ...prev,
        tempUserMsg,
        tempAssistantMsg,
      ]);
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
      activeSessionIdRef,
      agentDefaultModel,
      createSession,
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

  return {
    abortSession,
    answerPermission,
    refreshMessages,
    sendMessage,
  };
}

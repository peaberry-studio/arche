"use client";

import { useCallback, type MutableRefObject, type SetStateAction } from "react";

import { abortSessionAction } from "@/actions/workspace-sessions";
import {
  PRE_SESSION_SELECTION_KEY,
  type SessionSelectionState,
} from "@/hooks/workspace/workspace-types";
import { isSending, type ChatStore } from "@/lib/workspace-events/reducer";
import type { MessageAttachmentInput } from "@/types/workspace";
import type {
  AvailableModel,
  PermissionResponse,
  WorkspaceSession,
} from "@/types/workspace-runtime";

type UseWorkspaceMessageActionsOptions = {
  slug: string;
  activeSessionIdRef: MutableRefObject<string | null>;
  getSessions?: () => WorkspaceSession[];
  agentDefaultModel: AvailableModel | null;
  createSession: (title?: string) => Promise<WorkspaceSession | null>;
  models: AvailableModel[];
  primaryAgentId: string | null;
  refreshMessages: (sessionIdOverride?: string) => Promise<void>;
  sessionSelectionStateRef: MutableRefObject<Record<string, SessionSelectionState>>;
  getStore: () => ChatStore;
  commitStore: (store: SetStateAction<ChatStore>) => void;
  onStartingNewSessionChange: (value: boolean) => void;
};

function normalizeAttachments(attachments: MessageAttachmentInput[] | undefined): MessageAttachmentInput[] {
  return (attachments ?? []).filter(
    (attachment) => typeof attachment.path === "string" && attachment.path.trim().length > 0,
  );
}

function normalizeContextPaths(contextPaths: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (contextPaths ?? [])
        .filter((path): path is string => typeof path === "string")
        .map((path) => path.trim())
        .filter((path) => path.length > 0),
    ),
  );
}

export function useWorkspaceMessageActions({
  slug,
  activeSessionIdRef,
  getSessions,
  agentDefaultModel,
  createSession,
  models,
  primaryAgentId,
  refreshMessages,
  sessionSelectionStateRef,
  getStore,
  commitStore,
  onStartingNewSessionChange,
}: UseWorkspaceMessageActionsOptions) {
  const sendMessage = useCallback(
    async (
      text: string,
      model?: { providerId: string; modelId: string },
      options?: {
        forceNewSession?: boolean;
        attachments?: MessageAttachmentInput[];
        contextPaths?: string[];
      },
    ) => {
      const targetSessionId = activeSessionIdRef.current;
      const messageAttachments = normalizeAttachments(options?.attachments);
      const messageContextPaths = normalizeContextPaths(options?.contextPaths);

      const forceNewSession = options?.forceNewSession === true;
      if (!forceNewSession && getSessions?.().find((session) => session.id === targetSessionId)?.archived) return false;
      let sessionId = targetSessionId;
      if (forceNewSession || !sessionId) {
        onStartingNewSessionChange(true);
        try {
          const newSession = await createSession();
          sessionId = newSession?.id ?? null;
        } finally {
          onStartingNewSessionChange(false);
        }
      }
      if (!sessionId) return false;

      if (isSending(getStore(), sessionId)) {
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

      const messageId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `user-${Date.now()}`;

      const previousStatus = getStore().sessionStatus[sessionId] ?? "idle";

      const restoreStatus = (status: "idle" | "busy" = previousStatus) => {
        commitStore((current) => ({
          ...current,
          sessionStatus: { ...current.sessionStatus, [sessionId]: status },
        }));
      };

      commitStore((current) => ({
        ...current,
        sessionStatus: { ...current.sessionStatus, [sessionId]: "busy" },
      }));

      let result: Response;
      try {
        result = await fetch(`/api/w/${slug}/chat/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            messageId,
            ...(text ? { text } : {}),
            ...(resolvedModel ? { model: resolvedModel } : {}),
            ...(messageAttachments.length > 0 ? { attachments: messageAttachments } : {}),
            ...(messageContextPaths.length > 0 ? { contextPaths: messageContextPaths } : {}),
          }),
        });
      } catch {
        restoreStatus();
        return false;
      }

      if (!result.ok) {
        const body = await result.json().catch(() => null);
        restoreStatus(body?.error === "session_archived" ? "idle" : result.status === 409 ? "busy" : previousStatus);
        return false;
      }

      // The prompt travels out-of-band while the event pipe may still be
      // connecting or mid-reconnect; runtime events emitted in that window are
      // never re-delivered, and no other trigger refreshes messages after a
      // send. Re-hydrating once the prompt is accepted keeps the sent message
      // visible even when its events were missed.
      void refreshMessages(sessionId);

      return true;
    },
    [
      activeSessionIdRef,
      agentDefaultModel,
      commitStore,
      createSession,
      getStore,
      getSessions,
      models,
      onStartingNewSessionChange,
      primaryAgentId,
      refreshMessages,
      sessionSelectionStateRef,
      slug,
    ],
  );

  const answerPermission = useCallback(
    async (
      permissionSessionId: string,
      permissionId: string,
      response: PermissionResponse,
    ) => {
      if (getSessions?.().find((session) => session.id === permissionSessionId)?.archived) return false;
      try {
        const reply = await fetch(
          `/api/w/${slug}/chat/permissions/${encodeURIComponent(permissionId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: permissionSessionId, response }),
          },
        );
        if (!reply.ok) return false;
        return true;
      } catch {
        return false;
      }
    },
    [getSessions, slug],
  );

  const abortSession = useCallback(async () => {
    const currentActiveSessionId = activeSessionIdRef.current;
    if (!currentActiveSessionId) return;
    if (getSessions?.().find((session) => session.id === currentActiveSessionId)?.archived) return;
    await abortSessionAction(slug, currentActiveSessionId).catch(() => undefined);
    // The bus applies session.status idle; the store stays coherent on its own.
  }, [activeSessionIdRef, getSessions, slug]);

  return {
    sendMessage,
    answerPermission,
    abortSession,
  };
}

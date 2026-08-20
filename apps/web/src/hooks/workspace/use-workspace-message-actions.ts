"use client";

import { useCallback, type MutableRefObject, type SetStateAction } from "react";

import { abortSessionAction, listPermissionsAction } from "@/actions/opencode";
import {
  PRE_SESSION_SELECTION_KEY,
  type SessionSelectionState,
} from "@/hooks/workspace/workspace-types";
import { isSending, type ChatStore } from "@/lib/opencode/event-reducer";
import type {
  AvailableModel,
  PermissionResponse,
  WorkspaceSession,
} from "@/lib/opencode/types";
import type { MessageAttachmentInput } from "@/types/workspace";

type UseWorkspaceMessageActionsOptions = {
  slug: string;
  activeSessionIdRef: MutableRefObject<string | null>;
  agentDefaultModel: AvailableModel | null;
  createSession: (title?: string) => Promise<WorkspaceSession | null>;
  models: AvailableModel[];
  primaryAgentId: string | null;
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
  agentDefaultModel,
  createSession,
  models,
  primaryAgentId,
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
        restoreStatus(result.status === 409 ? "busy" : previousStatus);
        return false;
      }

      return true;
    },
    [
      activeSessionIdRef,
      agentDefaultModel,
      commitStore,
      createSession,
      getStore,
      models,
      onStartingNewSessionChange,
      primaryAgentId,
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

        // Safety net: if no permission.replied arrives via the bus, re-read the
        // permission list to clear any ghost. OpenCode remains the truth.
        setTimeout(async () => {
          const listed = await listPermissionsAction(slug);
          if (!listed.ok || !listed.permissions) return;
          const fresh = listed.permissions[permissionSessionId];
          commitStore((current) => {
            const nextPermissions = { ...current.permissions };
            if (!fresh || fresh.length === 0) {
              delete nextPermissions[permissionSessionId];
            } else {
              nextPermissions[permissionSessionId] = fresh;
            }
            return { ...current, permissions: nextPermissions };
          });
        }, 10_000);
        return true;
      } catch {
        return false;
      }
    },
    [commitStore, slug],
  );

  const abortSession = useCallback(async () => {
    const currentActiveSessionId = activeSessionIdRef.current;
    if (!currentActiveSessionId) return;
    await abortSessionAction(slug, currentActiveSessionId).catch(() => undefined);
    // The bus applies session.status idle; the store stays coherent on its own.
  }, [activeSessionIdRef, slug]);

  return {
    sendMessage,
    answerPermission,
    abortSession,
  };
}

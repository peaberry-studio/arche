"use client";

import { useCallback, useRef, useState, type SetStateAction } from "react";

import { listMessagesAction } from "@/actions/opencode";
import type { WorkspaceMessage } from "@/lib/opencode/types";
import { SerialJobExecutor } from "@/lib/serial-job-executor";
import type { ResumeFailureState } from "@/lib/workspace-resume-policy";
import {
  areMessageListsEqual,
  EMPTY_WORKSPACE_MESSAGES,
} from "@/hooks/workspace/workspace-types";

type UseWorkspaceMessagesOptions = {
  slug: string;
  getActiveSessionId: () => string | null;
  onHydrated?: (sessionId: string, messages: WorkspaceMessage[]) => void;
};

export function useWorkspaceMessages({
  slug,
  getActiveSessionId,
  onHydrated,
}: UseWorkspaceMessagesOptions) {
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, WorkspaceMessage[]>
  >({});
  const [loadingMessageSessionIds, setLoadingMessageSessionIds] = useState<string[]>([]);

  const sessionExecutorsRef = useRef(new Map<string, SerialJobExecutor>());
  const resumeFailureStateRef = useRef<Map<string, ResumeFailureState>>(new Map());

  const updateSessionMessages = useCallback(
    (
      sessionId: string,
      updater: SetStateAction<WorkspaceMessage[]>
    ) => {
      setMessagesBySession((prev) => {
        const previousMessages = prev[sessionId] ?? EMPTY_WORKSPACE_MESSAGES;
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

  const refreshMessages = useCallback(async (sessionIdOverride?: string) => {
    const targetSessionId = sessionIdOverride ?? getActiveSessionId();

    if (!targetSessionId) return;

    const executor = getSessionExecutor(targetSessionId);
    await executor.run(async () => {
      setSessionLoading(targetSessionId, true);
      try {
        const result = await listMessagesAction(slug, targetSessionId);

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
          onHydrated?.(targetSessionId, hydratedMessages);
        }
      } finally {
        setSessionLoading(targetSessionId, false);
      }
    });
  }, [
    slug,
    getActiveSessionId,
    getSessionExecutor,
    setSessionLoading,
    updateSessionMessages,
    onHydrated,
  ]);

  const removeSessions = useCallback((sessionIds: Set<string>) => {
    setMessagesBySession((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const sessionId of sessionIds) {
        if (!(sessionId in next)) continue;
        delete next[sessionId];
        changed = true;
      }
      return changed ? next : prev;
    });

    setLoadingMessageSessionIds((prev) =>
      prev.filter((sessionId) => !sessionIds.has(sessionId))
    );

    for (const sessionId of sessionIds) {
      resumeFailureStateRef.current.delete(sessionId);
      sessionExecutorsRef.current.delete(sessionId);
    }
  }, []);

  const activeSessionId = getActiveSessionId();
  const messages = activeSessionId ? messagesBySession[activeSessionId] ?? EMPTY_WORKSPACE_MESSAGES : EMPTY_WORKSPACE_MESSAGES;
  const isLoadingMessages = activeSessionId
    ? loadingMessageSessionIds.includes(activeSessionId)
    : false;

  return {
    messages,
    isLoadingMessages,
    updateSessionMessages,
    refreshMessages,
    resumeFailureStateRef,
    removeSessions,
  };
}

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

  // Source of truth for message state; setState only notifies React after sync ref updates.
  const messagesBySessionRef = useRef<Record<string, WorkspaceMessage[]>>({});
  const sessionExecutorsRef = useRef(new Map<string, SerialJobExecutor>());
  const resumeFailureStateRef = useRef<Map<string, ResumeFailureState>>(new Map());

  const updateSessionMessages = useCallback(
    (
      sessionId: string,
      updater: SetStateAction<WorkspaceMessage[]>
    ) => {
      const previousMessages = messagesBySessionRef.current[sessionId] ?? EMPTY_WORKSPACE_MESSAGES;
      const nextMessages =
        typeof updater === "function"
          ? updater(previousMessages)
          : updater;

      if (
        nextMessages === previousMessages ||
        areMessageListsEqual(previousMessages, nextMessages)
      ) {
        return;
      }

      const nextMessagesBySession = {
        ...messagesBySessionRef.current,
        [sessionId]: nextMessages,
      };
      messagesBySessionRef.current = nextMessagesBySession;
      setMessagesBySession(nextMessagesBySession);
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
    const nextMessagesBySession = { ...messagesBySessionRef.current };
    const removedMessageIds = new Set<string>();
    let changed = false;

    for (const sessionId of sessionIds) {
      const messages = nextMessagesBySession[sessionId];
      if (!messages) continue;

      for (const message of messages) {
        removedMessageIds.add(message.id);
      }

      delete nextMessagesBySession[sessionId];
      changed = true;
    }

    if (changed) {
      messagesBySessionRef.current = nextMessagesBySession;
      setMessagesBySession(nextMessagesBySession);
    }

    setLoadingMessageSessionIds((prev) =>
      prev.filter((sessionId) => !sessionIds.has(sessionId))
    );

    for (const messageId of removedMessageIds) {
      resumeFailureStateRef.current.delete(messageId);
    }

    for (const sessionId of sessionIds) {
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

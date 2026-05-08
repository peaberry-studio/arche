"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";

import type { WorkspaceMessage, WorkspaceSession } from "@/lib/opencode/types";
import {
  canAutoResume,
  type ResumeFailureState,
} from "@/lib/workspace-resume-policy";
import { STALE_PENDING_ASSISTANT_MS, type StreamOptions } from "@/hooks/workspace/workspace-types";

type StreamStatus = "submitted" | "streaming" | "error";

export function useWorkspaceResumeEffect({
  activeSession,
  activeSessionId,
  activeStreamsRef,
  enabled,
  isConnected,
  messages,
  resumeFailureStateRef,
  sessionStreamStatusRef,
  streamChat,
  updateSessionMessages,
}: {
  activeSession: WorkspaceSession | null;
  activeSessionId: string | null;
  activeStreamsRef: MutableRefObject<Map<string, unknown>>;
  enabled: boolean;
  isConnected: boolean;
  messages: WorkspaceMessage[];
  resumeFailureStateRef: MutableRefObject<Map<string, ResumeFailureState>>;
  sessionStreamStatusRef: MutableRefObject<Record<string, StreamStatus>>;
  streamChat: (options: StreamOptions) => Promise<void>;
  updateSessionMessages: (
    sessionId: string,
    updater: (messages: WorkspaceMessage[]) => WorkspaceMessage[]
  ) => void;
}) {
  const pendingAssistantKey = useMemo(() => {
    const pending: string[] = [];
    for (const message of messages) {
      if (message.role === "assistant" && message.pending) {
        pending.push(message.id);
      }
    }
    return pending.join(",");
  }, [messages]);

  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!activeSessionId || !enabled || !isConnected) return;
    const resumeStatus = sessionStreamStatusRef.current[activeSessionId];
    if (resumeStatus === "submitted" || resumeStatus === "streaming") return;

    const existingStream = activeStreamsRef.current.get(activeSessionId);
    if (existingStream) {
      return;
    }

    const currentMessages = messagesRef.current;
    const now = Date.now();
    const sessionBusy = activeSession?.status === "busy";

    const stalePendingWithoutParts = [...currentMessages].reverse().find((message) => {
      if (message.role !== "assistant" || !message.pending) return false;
      if (message.parts.length > 0) return false;
      if (typeof message.timestampRaw !== "number") return false;
      return now - message.timestampRaw >= STALE_PENDING_ASSISTANT_MS;
    });

    if (stalePendingWithoutParts && !sessionBusy) {
      updateSessionMessages(activeSessionId, (prev) =>
        prev.map((message) => {
          if (message.id !== stalePendingWithoutParts.id) return message;
          return {
            ...message,
            pending: false,
            statusInfo: { status: "error", detail: "stream_incomplete" },
          };
        })
      );
      return;
    }

    const pendingAssistant = [...currentMessages].reverse().find((message) => {
      if (message.role !== "assistant" || !message.pending) return false;

      const resumeState = resumeFailureStateRef.current.get(message.id);
      const allowed = canAutoResume(resumeState, now);

      if (allowed && resumeState?.suppressed) {
        resumeFailureStateRef.current.delete(message.id);
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
    enabled,
    isConnected,
    pendingAssistantKey,
    activeStreamsRef,
    resumeFailureStateRef,
    sessionStreamStatusRef,
    streamChat,
    updateSessionMessages,
  ]);
}

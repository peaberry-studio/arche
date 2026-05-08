/** @vitest-environment jsdom */

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceResumeEffect } from "@/hooks/workspace/use-workspace-resume-effect";
import type { WorkspaceMessage, WorkspaceSession } from "@/lib/opencode/types";
import type { ResumeFailureState } from "@/lib/workspace-resume-policy";

const pendingAssistant: WorkspaceMessage = {
  id: "assistant-1",
  sessionId: "s1",
  role: "assistant",
  content: "",
  timestamp: "now",
  timestampRaw: Date.now() - 10_000,
  parts: [],
  pending: true,
};

const busySession: WorkspaceSession = {
  id: "s1",
  title: "Busy",
  status: "busy",
  updatedAt: "now",
};

const idleSession: WorkspaceSession = {
  ...busySession,
  status: "idle",
};

function renderResumeEffect({
  activeSession = busySession,
  activeSessionId = "s1",
  activeStreams = new Map<string, unknown>(),
  enabled = true,
  isConnected = true,
  messages = [pendingAssistant],
  resumeFailures = new Map<string, ResumeFailureState>(),
  sessionStatus = {},
  streamChat = vi.fn(),
  updateSessionMessages = vi.fn(),
}: {
  activeSession?: WorkspaceSession | null;
  activeSessionId?: string | null;
  activeStreams?: Map<string, unknown>;
  enabled?: boolean;
  isConnected?: boolean;
  messages?: WorkspaceMessage[];
  resumeFailures?: Map<string, ResumeFailureState>;
  sessionStatus?: Record<string, "submitted" | "streaming" | "error">;
  streamChat?: ReturnType<typeof vi.fn>;
  updateSessionMessages?: ReturnType<typeof vi.fn>;
} = {}) {
  renderHook(() =>
    useWorkspaceResumeEffect({
      activeSession,
      activeSessionId,
      activeStreamsRef: { current: activeStreams },
      enabled,
      isConnected,
      messages,
      resumeFailureStateRef: { current: resumeFailures },
      sessionStreamStatusRef: { current: sessionStatus },
      streamChat,
      updateSessionMessages,
    })
  );

  return { resumeFailures, streamChat, updateSessionMessages };
}

describe("useWorkspaceResumeEffect", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not resume when the workspace is disconnected", () => {
    const { streamChat } = renderResumeEffect({ isConnected: false });

    expect(streamChat).not.toHaveBeenCalled();
  });

  it("does not resume while the session is already streaming", () => {
    const { streamChat } = renderResumeEffect({
      sessionStatus: { s1: "streaming" },
    });

    expect(streamChat).not.toHaveBeenCalled();
  });

  it("does not resume when an active stream exists", () => {
    const { streamChat } = renderResumeEffect({
      activeStreams: new Map([["s1", {}]]),
    });

    expect(streamChat).not.toHaveBeenCalled();
  });

  it("marks stale idle pending assistants as incomplete", () => {
    const { updateSessionMessages } = renderResumeEffect({
      activeSession: idleSession,
    });

    expect(updateSessionMessages).toHaveBeenCalledTimes(1);
    const updater = updateSessionMessages.mock.calls[0][1] as (
      messages: WorkspaceMessage[]
    ) => WorkspaceMessage[];
    expect(updater([pendingAssistant])).toEqual([
      {
        ...pendingAssistant,
        pending: false,
        statusInfo: { status: "error", detail: "stream_incomplete" },
      },
    ]);
  });

  it("does not resume idle pending assistants without parts", () => {
    const { streamChat } = renderResumeEffect({
      activeSession: idleSession,
      messages: [{ ...pendingAssistant, timestampRaw: Date.now() }],
    });

    expect(streamChat).not.toHaveBeenCalled();
  });

  it("resumes pending assistants with parts in idle sessions", () => {
    const { streamChat } = renderResumeEffect({
      activeSession: idleSession,
      messages: [
        {
          ...pendingAssistant,
          parts: [{ type: "text", text: "partial" }],
        },
      ],
    });

    expect(streamChat).toHaveBeenCalledWith({
      sessionId: "s1",
      mode: "resume",
      targetMessageId: "assistant-1",
    });
  });

  it("clears suppressed resume state after cooldown allows retry", () => {
    const resumeFailures = new Map<string, ResumeFailureState>([
      ["assistant-1", { failures: 2, lastFailureAt: 0, suppressed: true }],
    ]);
    const { streamChat } = renderResumeEffect({ resumeFailures });

    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(resumeFailures.has("assistant-1")).toBe(false);
  });
});

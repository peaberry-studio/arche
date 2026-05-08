import { beforeEach, describe, expect, it, vi } from "vitest";

import { listMessagesAction } from "@/actions/opencode";
import {
  loadLatestMessagesWithRetry,
  reconcileStreamMessages,
} from "@/hooks/workspace/use-workspace-streaming";
import type { WorkspaceMessage } from "@/lib/opencode/types";

const opencodeMocks = vi.hoisted(() => ({
  listMessagesAction: vi.fn(),
}));

vi.mock("@/actions/opencode", () => opencodeMocks);

const assistantMessage: WorkspaceMessage = {
  id: "assistant-1",
  sessionId: "s1",
  role: "assistant",
  content: "Done",
  timestamp: "now",
  parts: [{ type: "text", id: "part-1", text: "Done" }],
  pending: false,
};

describe("workspace streaming helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(listMessagesAction).mockReset();
  });

  it("retries send reconciliation until the assistant message is visible", async () => {
    vi.mocked(listMessagesAction)
      .mockResolvedValueOnce({ ok: true, messages: [] })
      .mockResolvedValueOnce({ ok: true, messages: [assistantMessage] });

    const promise = loadLatestMessagesWithRetry({
      slug: "alice",
      sessionId: "s1",
      mode: "send",
      assistantMessageId: "assistant-1",
    });

    await vi.advanceTimersByTimeAsync(250);

    await expect(promise).resolves.toEqual({
      ok: true,
      messages: [assistantMessage],
    });
    expect(listMessagesAction).toHaveBeenCalledTimes(2);
  });

  it("marks suppressed resume messages as exhausted during hydration", () => {
    const resumeFailureState = new Map([
      ["assistant-1", { attempts: 3, lastFailureAt: 1, suppressed: true }],
    ]);

    const result = reconcileStreamMessages({
      mode: "resume",
      assistantMessageId: "assistant-1",
      targetMessageId: "assistant-1",
      receivedAssistantPart: false,
      receivedStreamData: true,
      terminalErrorDetail: null,
      result: { ok: true, messages: [{ ...assistantMessage, pending: true }] },
      resumeFailureState,
    });

    expect(result).toEqual({
      action: "hydrate",
      messages: [
        {
          ...assistantMessage,
          pending: false,
          statusInfo: { status: "error", detail: "resume_exhausted" },
        },
      ],
    });
  });

  it("returns fallback errors when the stream fails before server hydration", () => {
    const result = reconcileStreamMessages({
      mode: "send",
      assistantMessageId: null,
      targetMessageId: "temp-assistant",
      receivedAssistantPart: false,
      receivedStreamData: true,
      terminalErrorDetail: "provider_down",
      result: { ok: true, messages: [] },
      resumeFailureState: new Map(),
    });

    expect(result).toEqual({
      action: "fallback-error",
      messageId: "temp-assistant",
      detail: "provider_down",
    });
  });

  it("flags empty completed assistant messages as incomplete", () => {
    const result = reconcileStreamMessages({
      mode: "send",
      assistantMessageId: "assistant-1",
      targetMessageId: "temp-assistant",
      receivedAssistantPart: false,
      receivedStreamData: true,
      terminalErrorDetail: null,
      result: {
        ok: true,
        messages: [{ ...assistantMessage, content: "", parts: [] }],
      },
      resumeFailureState: new Map(),
    });

    expect(result).toEqual({
      action: "hydrate",
      messages: [
        {
          ...assistantMessage,
          content: "",
          parts: [],
          statusInfo: { status: "error", detail: "stream_incomplete" },
        },
      ],
    });
  });
});

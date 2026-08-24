import { describe, expect, it } from "vitest";

import { isStreamingReasoningPart } from "@/components/workspace/chat-panel/is-streaming-reasoning-part";
import type { MessagePart } from "@/lib/opencode/types";
import type { ChatMessage } from "@/types/workspace";

function assistantMessage(parts: MessagePart[], overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: "a1",
    sessionId: "s1",
    role: "assistant",
    content: "",
    timestamp: "10:00",
    parts,
    ...overrides,
  };
}

const reasoningPart: MessagePart = { type: "reasoning", id: "r-1", text: "Thinking it through" };
const textPart: MessagePart = { type: "text", id: "t-1", text: "The answer" };

function isStreaming(overrides?: Partial<Parameters<typeof isStreamingReasoningPart>[0]>) {
  return isStreamingReasoningPart({
    isSessionBusy: true,
    isLastMessage: true,
    message: assistantMessage([reasoningPart]),
    part: reasoningPart,
    ...overrides,
  });
}

describe("isStreamingReasoningPart", () => {
  it("returns true for the last reasoning part of the last assistant message while the session is busy", () => {
    expect(isStreaming()).toBe(true);
  });

  it("returns false when the session is idle", () => {
    expect(isStreaming({ isSessionBusy: false })).toBe(false);
  });

  it("returns false for a message that is not the last one", () => {
    expect(isStreaming({ isLastMessage: false })).toBe(false);
  });

  it("returns false for a non-assistant message", () => {
    expect(
      isStreaming({ message: assistantMessage([reasoningPart], { role: "user" }) }),
    ).toBe(false);
  });

  it("returns false for a part that is not reasoning", () => {
    expect(isStreaming({ part: textPart, message: assistantMessage([textPart]) })).toBe(false);
  });

  it("returns false when another part follows the reasoning block", () => {
    expect(
      isStreaming({
        part: reasoningPart,
        message: assistantMessage([reasoningPart, textPart]),
      }),
    ).toBe(false);
  });

  it("returns false when the message has no parts", () => {
    expect(isStreaming({ part: reasoningPart, message: assistantMessage([]) })).toBe(false);
  });
});

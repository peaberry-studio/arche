/** @vitest-environment jsdom */

import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatPanelMessages } from "@/components/workspace/chat-panel/messages";
import {
  createEmptyChatStore,
  isSending,
  reduceOpenCodeEvent,
  type ChatStore,
} from "@/lib/opencode/event-reducer";
import type { ChatMessage } from "@/types/workspace";

/**
 * Full production-flow simulation: real SSE event sequence → event reducer →
 * isSending → ChatPanelMessages render. Verifies the typing dots appear on the
 * active reasoning block exactly as they should in the live app.
 */
function apply(store: ChatStore, type: string, properties: Record<string, unknown>): ChatStore {
  return reduceOpenCodeEvent(store, { type, properties }).store;
}

function streamReasoningResponse(): ChatStore {
  let store = createEmptyChatStore();

  // Session goes busy (bus event).
  store = apply(store, "session.status", {
    sessionID: "s1",
    status: { type: "busy" },
  });

  // User message.
  store = apply(store, "message.updated", {
    info: { id: "u1", role: "user", sessionID: "s1", time: { created: 1 }, parts: [{ type: "text", text: "Hola" }] },
  });

  // Assistant message created.
  store = apply(store, "message.updated", {
    info: { id: "m1", role: "assistant", sessionID: "s1", time: { created: 2 } },
  });

  // Full-message snapshot with step-start + empty reasoning placeholder
  // (the server includes step-start parts in message.updated snapshots).
  store = apply(store, "message.updated", {
    info: {
      id: "m1",
      role: "assistant",
      sessionID: "s1",
      time: { created: 2 },
      parts: [
        { type: "step-start", id: "ss1" },
        { type: "reasoning", id: "r1", text: "" },
      ],
    },
  });

  // Reasoning streams via deltas.
  store = apply(store, "message.part.delta", {
    sessionID: "s1",
    messageID: "m1",
    partID: "r1",
    field: "text",
    delta: "Thinking ",
  });
  store = apply(store, "message.part.delta", {
    sessionID: "s1",
    messageID: "m1",
    partID: "r1",
    field: "text",
    delta: "it through",
  });

  return store;
}

function toUiMessages(store: ChatStore): ChatMessage[] {
  return (store.messages.s1 ?? []).map((m) => ({
    id: m.id,
    sessionId: m.sessionId,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    timestampRaw: m.timestampRaw,
    parts: m.parts,
    statusInfo: m.statusInfo,
    pending: m.pending,
  }));
}

function renderStreamingChat(store: ChatStore) {
  return render(
    <ChatPanelMessages
      chatContentStyle={{ height: 400 }}
      connectorNamesById={{}}
      isLoadingMessages={false}
      isStartingNewSession={false}
      isStreaming={isSending(store, "s1")}
      messages={toUiMessages(store)}
      messagesEndRef={createRef<HTMLDivElement>()}
      onOpenFile={() => {}}
      onScrollContainer={() => {}}
      scrollContainerRef={createRef<HTMLDivElement>()}
      sessionTabs={[]}
      slug="alice"
    />,
  );
}

describe("reasoning streaming full flow (SSE → reducer → UI)", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks the session busy and streams reasoning deltas into the last part", () => {
    const store = streamReasoningResponse();

    expect(isSending(store, "s1")).toBe(true);
    const assistant = store.messages.s1.find((m) => m.id === "m1");
    expect(assistant?.parts).toMatchObject([
      { type: "step-start", id: "ss1" },
      { type: "reasoning", id: "r1", text: "Thinking it through" },
    ]);
  });

  it("shows typing dots on the active reasoning block", () => {
    const store = streamReasoningResponse();

    renderStreamingChat(store);

    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.getByTestId("typing-dots")).toBeTruthy();
  });

  it("removes the dots when the session goes idle", () => {
    const store = streamReasoningResponse();
    const idleStore = apply(store, "session.idle", { sessionID: "s1" });

    expect(isSending(idleStore, "s1")).toBe(false);

    renderStreamingChat(idleStore);

    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.queryByTestId("typing-dots")).toBeNull();
  });
});

/** @vitest-environment jsdom */

import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatPanelMessages } from "@/components/workspace/chat-panel/messages";
import {
  createEmptyChatStore,
  isSending,
  reduceArcheEvent,
  type ChatStore,
} from "@/lib/workspace-events/reducer";
import type { ArcheEvent } from "@/lib/harness/events";
import type { ChatMessage } from "@/types/workspace";

/**
 * Full production-flow simulation: real SSE event sequence → event reducer →
 * isSending → ChatPanelMessages render. Verifies the typing dots appear on the
 * active reasoning block exactly as they should in the live app.
 */
function apply(store: ChatStore, event: ArcheEvent): ChatStore {
  return reduceArcheEvent(store, event).store;
}

function streamReasoningResponse(): ChatStore {
  let store = createEmptyChatStore();

  // Session goes busy (bus event).
  store = apply(store, { v: 1, type: "session.status", sessionId: "s1", status: "busy" });

  // User message.
  store = apply(store, { v: 1, type: "message.upserted", message: { id: "u1", role: "user", sessionId: "s1", timestamp: "", timestampRaw: 1, content: "Hola", parts: [{ type: "text", text: "Hola" }] } });

  // Assistant message created.
  store = apply(store, { v: 1, type: "message.upserted", message: { id: "m1", role: "assistant", sessionId: "s1", timestamp: "", timestampRaw: 2, content: "", parts: [] } });

  // Full-message snapshot with step-start + empty reasoning placeholder
  // (the server includes step-start parts in message.updated snapshots).
  store = apply(store, { v: 1, type: "message.upserted",
    message: {
      id: "m1",
      role: "assistant",
      sessionId: "s1",
      timestamp: "", timestampRaw: 2, content: "",
      parts: [
        { type: "step-start", id: "ss1" },
        { type: "reasoning", id: "r1", text: "" },
      ],
    },
  });

  // Reasoning streams via deltas.
  store = apply(store, { v: 1, type: "part.delta",
    sessionId: "s1",
    messageId: "m1",
    partId: "r1",
    field: "text",
    delta: "Thinking ",
  });
  store = apply(store, { v: 1, type: "part.delta",
    sessionId: "s1",
    messageId: "m1",
    partId: "r1",
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
    const idleStore = apply(store, { v: 1, type: "session.status", sessionId: "s1", status: "idle" });

    expect(isSending(idleStore, "s1")).toBe(false);

    renderStreamingChat(idleStore);

    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.queryByTestId("typing-dots")).toBeNull();
  });
});

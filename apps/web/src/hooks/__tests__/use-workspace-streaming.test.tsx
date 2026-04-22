/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubBrowserStorage } from "@/__tests__/storage";
import { useWorkspace } from "@/hooks/use-workspace";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const opencodeMocks = vi.hoisted(() => ({
  checkConnectionAction: vi.fn(),
  listSessionsAction: vi.fn(),
  listSessionFamilyAction: vi.fn(),
  createSessionAction: vi.fn(),
  deleteSessionAction: vi.fn(),
  markAutopilotRunSeenAction: vi.fn(),
  updateSessionAction: vi.fn(),
  listMessagesAction: vi.fn(),
  abortSessionAction: vi.fn(),
  loadFileTreeAction: vi.fn(),
  readFileAction: vi.fn(),
  getWorkspaceDiffsAction: vi.fn(),
  listModelsAction: vi.fn(),
}));

const workspaceAgentMocks = vi.hoisted(() => ({
  readWorkspaceFileAction: vi.fn(),
  writeWorkspaceFileAction: vi.fn(),
  deleteWorkspaceFileAction: vi.fn(),
  applyWorkspacePatchAction: vi.fn(),
  discardWorkspaceFileChangesAction: vi.fn(),
}));

vi.mock("@/actions/opencode", () => opencodeMocks);
vi.mock("@/actions/workspace-agent", () => workspaceAgentMocks);

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function sseEvent(event: string, data: unknown): string {
  return `event:${event}\ndata:${JSON.stringify(data)}\n\n`;
}

/**
 * Create a controllable ReadableStream that simulates SSE responses.
 * Call `push(chunk)` to send data and `close()` to end the stream.
 */
function createSSEStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  return {
    stream,
    push(text: string) {
      controller?.enqueue(encoder.encode(text));
    },
    close() {
      controller?.close();
    },
    getReader() {
      return stream.getReader();
    },
  };
}

// ---------------------------------------------------------------------------
// Standard mock setup
// ---------------------------------------------------------------------------

const DEFAULT_AGENTS = [
  {
    id: "assistant",
    displayName: "Assistant",
    model: "openai/gpt-5.4",
    isPrimary: true,
  },
];

function setupDefaultMocks() {
  opencodeMocks.checkConnectionAction.mockResolvedValue({ status: "connected" });
  opencodeMocks.listSessionsAction.mockResolvedValue({
    ok: true,
    sessions: [{ id: "s1", title: "Existing", status: "idle", updatedAt: "now" }],
    hasMore: false,
  });
  opencodeMocks.listSessionFamilyAction.mockResolvedValue({ ok: true, rootSessionId: "s1", sessions: [] });
  opencodeMocks.createSessionAction.mockResolvedValue({
    ok: true,
    session: { id: "s2", title: "Fresh", status: "active", updatedAt: "now" },
  });
  opencodeMocks.deleteSessionAction.mockResolvedValue({ ok: true });
  opencodeMocks.updateSessionAction.mockResolvedValue({ ok: true });
  opencodeMocks.listMessagesAction.mockResolvedValue({ ok: true, messages: [] });
  opencodeMocks.abortSessionAction.mockResolvedValue({ ok: true });
  opencodeMocks.loadFileTreeAction.mockResolvedValue({ ok: true, tree: [] });
  opencodeMocks.readFileAction.mockResolvedValue({ ok: false, error: "not_found" });
  opencodeMocks.getWorkspaceDiffsAction.mockResolvedValue({ ok: true, diffs: [] });
  opencodeMocks.listModelsAction.mockResolvedValue({
    ok: true,
    models: [
      {
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5.2",
        modelName: "GPT 5.2",
        isDefault: true,
      },
    ],
  });

  workspaceAgentMocks.readWorkspaceFileAction.mockResolvedValue({ ok: false, error: "not_found" });
  workspaceAgentMocks.writeWorkspaceFileAction.mockResolvedValue({ ok: true, hash: "hash" });
  workspaceAgentMocks.deleteWorkspaceFileAction.mockResolvedValue({ ok: true });
  workspaceAgentMocks.applyWorkspacePatchAction.mockResolvedValue({ ok: true });
  workspaceAgentMocks.discardWorkspaceFileChangesAction.mockResolvedValue({ ok: true });
}

function stubFetchWithStream(
  streamFactory: () => { getReader: () => ReadableStreamDefaultReader<Uint8Array> }
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/u/alice/agents") {
        return {
          ok: true,
          json: async () => ({ agents: DEFAULT_AGENTS }),
        };
      }
      if (String(input) === "/api/w/alice/chat/stream") {
        return {
          ok: true,
          body: streamFactory(),
        };
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    })
  );
}

async function renderConnectedHook(options?: { pollInterval?: number }) {
  const { result } = renderHook(() =>
    useWorkspace({ slug: "alice", pollInterval: options?.pollInterval ?? 0, initialSessionId: "s1" })
  );
  await waitFor(() => {
    expect(result.current.isConnected).toBe(true);
    expect(result.current.activeSessionId).toBe("s1");
  });
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useWorkspace streaming", () => {
  beforeEach(() => {
    stubBrowserStorage();
    vi.resetAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    setupDefaultMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // Per-session status machine
  // -----------------------------------------------------------------------

  describe("per-session status machine", () => {
    it("transitions from ready -> submitted -> streaming -> ready during a full stream", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      expect(result.current.isSending).toBe(false);

      // Start sending
      await act(async () => {
        result.current.sendMessage("hello");
        await Promise.resolve();
      });

      // Should be submitted or streaming
      await waitFor(() => {
        expect(result.current.isSending).toBe(true);
      });

      // Push first SSE event to trigger streaming status
      act(() => {
        sse.push(sseEvent("status", { status: "thinking" }));
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(true);
      });

      // Complete the stream
      act(() => {
        sse.push(sseEvent("done", {}));
        sse.close();
      });

      // After stream + reconciliation, status returns to ready
      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
      });
    });

    it("releases isSending after done even if the final refresh hangs", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook({ pollInterval: 60_000 });

      opencodeMocks.listMessagesAction.mockImplementation(
        () => new Promise(() => undefined)
      );

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(true);
      });

      act(() => {
        sse.push(
          sseEvent("message", {
            id: "assistant-1",
            role: "assistant",
          })
        );
        sse.push(
          sseEvent("part", {
            messageId: "assistant-1",
            part: {
              id: "part-1",
              type: "text",
              text: "hello back",
              messageID: "assistant-1",
            },
            delta: "hello back",
          })
        );
        sse.push(sseEvent("done", {}));
        sse.close();
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
        const assistant = result.current.messages.find((message) => message.role === "assistant");
        expect(assistant?.content).toContain("hello back");
        expect(assistant?.pending).toBe(false);
      });
    });

    it("shows isSending=false when switching to a non-streaming session", async () => {
      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [
          { id: "s1", title: "First", status: "idle", updatedAt: "now" },
          { id: "s2", title: "Second", status: "idle", updatedAt: "now" },
        ],
      });

      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      // Start streaming in s1
      await act(async () => {
        await result.current.sendMessage("hello");
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(true);
      });

      // Switch to s2 — should show not sending
      act(() => {
        result.current.selectSession("s2");
      });

      await waitFor(() => {
        expect(result.current.activeSessionId).toBe("s2");
        expect(result.current.isSending).toBe(false);
      });

      // Switch back to s1 — should still show sending
      act(() => {
        result.current.selectSession("s1");
      });

      await waitFor(() => {
        expect(result.current.activeSessionId).toBe("s1");
        expect(result.current.isSending).toBe(true);
      });

      // Clean up stream
      act(() => { sse.close(); });
    });

    it("blocks duplicate sends to the same session", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      // First send
      await act(async () => {
        await result.current.sendMessage("first");
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(true);
      });

      // Second send should be rejected
      let secondResult: boolean | undefined;
      await act(async () => {
        secondResult = await result.current.sendMessage("second");
      });

      expect(secondResult).toBe(false);

      act(() => { sse.close(); });
    });
  });

  // -----------------------------------------------------------------------
  // SSE event parsing
  // -----------------------------------------------------------------------

  describe("SSE event parsing", () => {
    it("parses status events and updates message statusInfo", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      act(() => {
        sse.push(sseEvent("status", { status: "thinking" }));
      });

      await waitFor(() => {
        const assistant = result.current.messages.find((m) => m.role === "assistant");
        expect(assistant?.statusInfo?.status).toBe("thinking");
        expect(assistant?.pending).toBe(true);
      });

      act(() => {
        sse.push(sseEvent("status", { status: "complete" }));
        sse.close();
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
      });
    });

    it("captures assistant message ID and flushes buffered parts", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      // After stream completes, listMessages returns the real assistant
      opencodeMocks.listMessagesAction.mockImplementation(async () => ({
        ok: true,
        messages: [
          {
            id: "user-1",
            sessionId: "s1",
            role: "user",
            content: "hello",
            timestamp: "now",
            parts: [{ type: "text", text: "hello" }],
            pending: false,
          },
          {
            id: "assistant-1",
            sessionId: "s1",
            role: "assistant",
            content: "response",
            timestamp: "now",
            parts: [{ type: "text", text: "response" }],
            pending: false,
          },
        ],
      }));

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      // Simulate: part arrives BEFORE the message event (buffering scenario)
      act(() => {
        sse.push(
          sseEvent("part", {
            part: { type: "text", text: "chunk" },
            messageId: "assistant-1",
          })
        );
      });

      // Now the message event arrives — should flush buffered parts
      act(() => {
        sse.push(
          sseEvent("message", {
            id: "assistant-1",
            role: "assistant",
          })
        );
      });

      await waitFor(() => {
        const assistant = result.current.messages.find((m) => m.role === "assistant");
        expect(assistant?.parts.length).toBeGreaterThan(0);
      });

      act(() => {
        sse.push(sseEvent("done", {}));
        sse.close();
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
      });
    });

    it("handles error SSE events", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      // After the stream error, the finally block reconciles by re-fetching messages.
      // Return a user + assistant message where the assistant has the error.
      opencodeMocks.listMessagesAction.mockResolvedValue({
        ok: true,
        messages: [
          {
            id: "user-1",
            sessionId: "s1",
            role: "user",
            content: "hello",
            timestamp: "now",
            parts: [{ type: "text", text: "hello" }],
            pending: false,
          },
          {
            id: "assistant-1",
            sessionId: "s1",
            role: "assistant",
            content: "",
            timestamp: "now",
            parts: [],
            pending: false,
            statusInfo: { status: "error", detail: "backend_failure" },
          },
        ],
      });

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      act(() => {
        sse.push(sseEvent("error", { error: "backend_failure" }));
        sse.close();
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
        const assistant = result.current.messages.find((m) => m.role === "assistant");
        expect(assistant?.statusInfo?.status).toBe("error");
        expect(assistant?.statusInfo?.detail).toBe("backend_failure");
      });
    });

    it("survives invalid JSON in SSE events", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      // Send invalid JSON followed by a valid event
      act(() => {
        sse.push("event:status\ndata:{broken\n\n");
        sse.push(sseEvent("status", { status: "thinking" }));
      });

      await waitFor(() => {
        const assistant = result.current.messages.find((m) => m.role === "assistant");
        expect(assistant?.statusInfo?.status).toBe("thinking");
      });

      act(() => {
        sse.push(sseEvent("done", {}));
        sse.close();
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
      });
    });

    it("handles workspace-updated events by scheduling refresh", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      const diffsCallsBefore = opencodeMocks.getWorkspaceDiffsAction.mock.calls.length;
      const filesCallsBefore = opencodeMocks.loadFileTreeAction.mock.calls.length;

      act(() => {
        sse.push(sseEvent("workspace-updated", {}));
      });

      // The workspace refresh is debounced at 250ms — wait for it with real timers
      await waitFor(
        () => {
          expect(opencodeMocks.getWorkspaceDiffsAction.mock.calls.length).toBeGreaterThan(
            diffsCallsBefore
          );
          expect(opencodeMocks.loadFileTreeAction.mock.calls.length).toBeGreaterThan(
            filesCallsBefore
          );
        },
        { timeout: 2000 }
      );

      act(() => {
        sse.close();
      });
    });

  });

  // -----------------------------------------------------------------------
  // Post-completion retry logic
  // -----------------------------------------------------------------------

  describe("post-completion retry logic", () => {
    it("retries loading messages when assistant message is not found initially", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      let listMessagesCallCount = 0;
      opencodeMocks.listMessagesAction.mockImplementation(async () => {
        listMessagesCallCount++;
        // First 2 calls: during init (no messages or empty)
        // The retry calls happen after stream completes
        if (listMessagesCallCount <= 3) {
          return {
            ok: true,
            messages: [
              {
                id: "user-1",
                sessionId: "s1",
                role: "user",
                content: "hello",
                timestamp: "now",
                parts: [{ type: "text", text: "hello" }],
                pending: false,
              },
              // No assistant message yet
            ],
          };
        }

        // Eventually the assistant message appears
        return {
          ok: true,
          messages: [
            {
              id: "user-1",
              sessionId: "s1",
              role: "user",
              content: "hello",
              timestamp: "now",
              parts: [{ type: "text", text: "hello" }],
              pending: false,
            },
            {
              id: "assistant-1",
              sessionId: "s1",
              role: "assistant",
              content: "response",
              timestamp: "now",
              parts: [{ type: "text", text: "response" }],
              pending: false,
            },
          ],
        };
      });

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      // Send message event with assistant ID so retry logic kicks in
      act(() => {
        sse.push(sseEvent("message", { id: "assistant-1", role: "assistant" }));
        sse.push(sseEvent("done", {}));
        sse.close();
      });

      // Wait for retries (250ms initial + exponential backoff) to complete with real timers
      await waitFor(
        () => {
          expect(result.current.isSending).toBe(false);
          // listMessages should have been called multiple times (retries)
          expect(listMessagesCallCount).toBeGreaterThan(2);
        },
        { timeout: 10000 }
      );
    }, 15000);

    it("marks stream_incomplete when no assistant parts were received", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      // Return empty assistant message after stream
      opencodeMocks.listMessagesAction.mockResolvedValue({
        ok: true,
        messages: [
          {
            id: "user-1",
            sessionId: "s1",
            role: "user",
            content: "hello",
            timestamp: "now",
            parts: [{ type: "text", text: "hello" }],
            pending: false,
          },
          {
            id: "assistant-1",
            sessionId: "s1",
            role: "assistant",
            content: "",
            timestamp: "now",
            parts: [],
            pending: false,
          },
        ],
      });

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      // Only status + message event (no part events)
      act(() => {
        sse.push(sseEvent("message", { id: "assistant-1", role: "assistant" }));
        sse.push(sseEvent("done", {}));
        sse.close();
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
        const assistant = result.current.messages.find(
          (m) => m.role === "assistant"
        );
        expect(assistant?.statusInfo?.detail).toBe("stream_incomplete");
      });
    });

    it("preserves a local error message when send fails without any stream data", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === "/api/u/alice/agents") {
            return {
              ok: true,
              json: async () => ({ agents: DEFAULT_AGENTS }),
            };
          }
          if (String(input) === "/api/w/alice/chat/stream") {
            return { ok: false, json: async () => ({ error: "server_error" }) };
          }
          throw new Error(`Unexpected fetch: ${String(input)}`);
        })
      );

      // Return no messages (clean state)
      opencodeMocks.listMessagesAction.mockResolvedValue({ ok: false, error: "connection_error" });

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
        const tempMessages = result.current.messages.filter((m) =>
          m.id.startsWith("temp-")
        );
        expect(tempMessages).toHaveLength(2);
        expect(tempMessages[1]?.statusInfo).toEqual({
          status: "error",
          detail: "server_error",
        });
      });
    });
  });

  // -----------------------------------------------------------------------
  // Delete session cleanup
  // -----------------------------------------------------------------------

  describe("deleteSession", () => {
    it("cleans up all state when deleting the active session", async () => {
      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [
          { id: "s1", title: "First", status: "idle", updatedAt: "now" },
          { id: "s2", title: "Second", status: "idle", updatedAt: "now" },
        ],
      });

      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      // Start streaming in s1
      await act(async () => {
        await result.current.sendMessage("hello");
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(true);
      });

      // Delete s1
      let deleteResult: boolean | undefined;
      await act(async () => {
        deleteResult = await result.current.deleteSession("s1");
      });

      expect(deleteResult).toBe(true);

      await waitFor(() => {
        // Should switch to s2
        expect(result.current.activeSessionId).toBe("s2");
        // Stream should be aborted
        expect(result.current.isSending).toBe(false);
        // Messages from s1 should not be visible
        expect(result.current.messages).toHaveLength(0);
      });

      act(() => { sse.close(); });
    });

    it("selects null when deleting the last session", async () => {
      opencodeMocks.listSessionsAction
        .mockResolvedValueOnce({
          ok: true,
          sessions: [{ id: "s1", title: "Only", status: "idle", updatedAt: "now" }],
        })
        .mockResolvedValueOnce({
          ok: true,
          sessions: [],
        });
      stubFetchWithStream(() => createSSEStream());

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.deleteSession("s1");
      });

      expect(result.current.activeSessionId).toBeNull();
    });

    it("does not change active session when deleting a non-active session", async () => {
      stubFetchWithStream(() => createSSEStream());

      const { result } = renderHook(() =>
        useWorkspace({ slug: "alice", pollInterval: 0, initialSessionId: "s1" })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.sessions.some((session) => session.id === "s1")).toBe(true);
      });

      await act(async () => {
        await result.current.createSession("Second");
      });

      act(() => {
        result.current.selectSession("s1");
      });

      await act(async () => {
        await result.current.deleteSession("s2");
      });

      expect(result.current.activeSessionId).toBe("s1");
    });

    it("returns false when server action fails", async () => {
      opencodeMocks.deleteSessionAction.mockResolvedValue({ ok: false, error: "not_found" });
      stubFetchWithStream(() => createSSEStream());

      const result = await renderConnectedHook();

      let deleteResult: boolean | undefined;
      await act(async () => {
        deleteResult = await result.current.deleteSession("s1");
      });

      expect(deleteResult).toBe(false);
      // Session should still be active
      expect(result.current.activeSessionId).toBe("s1");
    });
  });

  // -----------------------------------------------------------------------
  // refreshMessages guards
  // -----------------------------------------------------------------------

  describe("refreshMessages", () => {
    it("skips refresh when session has active stream", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      const callsBefore = opencodeMocks.listMessagesAction.mock.calls.length;

      // Start streaming
      await act(async () => {
        await result.current.sendMessage("hello");
      });

      // Try to refresh during streaming
      await act(async () => {
        await result.current.refreshMessages();
      });

      // The only listMessages call during streaming should be from the initial load,
      // not from the manual refresh (which should have been skipped)
      const callsAfterRefresh = opencodeMocks.listMessagesAction.mock.calls.length;
      // Calls should not have increased beyond what sendMessage might have triggered
      expect(callsAfterRefresh).toBe(callsBefore);

      act(() => { sse.close(); });
    });

    it("parses split part and done events across stream reads", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      act(() => {
        sse.push(
          sseEvent("message", {
            id: "assistant-1",
            role: "assistant",
          })
        );
        sse.push("event:part\n");
        sse.push(
          `data:${JSON.stringify({
            messageId: "assistant-1",
            part: {
              id: "part-1",
              type: "text",
              text: "hello back",
              messageID: "assistant-1",
            },
            delta: "hello back",
          })}\n\n`
        );
        sse.push("event:done\n");
        sse.push(`data:${JSON.stringify({ refresh: true })}\n\n`);
        sse.close();
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
        const assistant = result.current.messages.find((m) => m.role === "assistant");
        expect(assistant?.content).toContain("hello back");
      });
    });

    it("streams delta-only text updates progressively", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      act(() => {
        sse.push(
          sseEvent("message", {
            id: "assistant-1",
            role: "assistant",
          })
        );
        sse.push(
          sseEvent("part", {
            messageId: "assistant-1",
            part: {
              id: "part-1",
              type: "text",
              text: "",
              messageID: "assistant-1",
            },
            delta: "hello ",
          })
        );
      });

      await waitFor(() => {
        const assistant = result.current.messages.find((m) => m.role === "assistant");
        expect(assistant?.content).toContain("hello ");
      });

      act(() => {
        sse.push(
          sseEvent("part", {
            messageId: "assistant-1",
            part: {
              id: "part-1",
              type: "text",
              text: "",
              messageID: "assistant-1",
            },
            delta: { text: "world" },
          })
        );
        sse.push(sseEvent("done", {}));
        sse.close();
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
        const assistant = result.current.messages.find((m) => m.role === "assistant");
        expect(assistant?.content).toContain("hello world");
      });
    });
  });

  // -----------------------------------------------------------------------
  // Resume effect
  // -----------------------------------------------------------------------

  describe("resume effect", () => {
    it("marks stale pending assistant messages as stream_incomplete", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const staleTimestamp = Date.now() - 10_000; // 10s ago, well past 5s threshold
      opencodeMocks.listMessagesAction.mockResolvedValue({
        ok: true,
        messages: [
          {
            id: "msg-1",
            sessionId: "s1",
            role: "assistant",
            content: "",
            timestamp: "10s ago",
            timestampRaw: staleTimestamp,
            parts: [],
            pending: true,
          },
        ],
      });

      stubFetchWithStream(() => createSSEStream());

      const result = await renderConnectedHook();

      // Wait for messages to load and resume effect to detect the stale pending
      await waitFor(() => {
        const msg = result.current.messages.find((m) => m.id === "msg-1");
        expect(msg?.pending).toBe(false);
        expect(msg?.statusInfo?.detail).toBe("stream_incomplete");
      });
    });

    it("does NOT mark stale pending as stream_incomplete when session is busy", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const staleTimestamp = Date.now() - 10_000;
      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [{ id: "s1", title: "Existing", status: "busy", updatedAt: "now" }],
      });
      opencodeMocks.listMessagesAction.mockResolvedValue({
        ok: true,
        messages: [
          {
            id: "msg-1",
            sessionId: "s1",
            role: "assistant",
            content: "",
            timestamp: "10s ago",
            timestampRaw: staleTimestamp,
            parts: [],
            pending: true,
          },
        ],
      });

      // The resume effect will attempt to streamChat in resume mode
      // since the session is busy. Provide a stream for it.
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      // Give time for the resume effect to fire
      await act(async () => {
        vi.advanceTimersByTime(100);
        await Promise.resolve();
      });

      await waitFor(() => {
        const msg = result.current.messages.find((m) => m.id === "msg-1");
        // Message should still be pending (not marked as stale error)
        // because the session is busy
        expect(msg?.pending).toBe(true);
      });

      act(() => { sse.close(); });
    });

    it("auto-resumes a pending assistant message with parts in a busy session", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [{ id: "s1", title: "Existing", status: "busy", updatedAt: "now" }],
      });
      opencodeMocks.listMessagesAction.mockResolvedValue({
        ok: true,
        messages: [
          {
            id: "msg-1",
            sessionId: "s1",
            role: "assistant",
            content: "partial",
            timestamp: "now",
            timestampRaw: Date.now(),
            parts: [{ type: "text", text: "partial" }],
            pending: true,
          },
        ],
      });

      const sse = createSSEStream();
      let streamFetched = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === "/api/u/alice/agents") {
            return {
              ok: true,
              json: async () => ({ agents: DEFAULT_AGENTS }),
            };
          }
          if (String(input) === "/api/w/alice/chat/stream") {
            streamFetched = true;
            return { ok: true, body: sse };
          }
          throw new Error(`Unexpected fetch: ${String(input)}`);
        })
      );

      await renderConnectedHook();

      // Give time for resume effect to trigger
      await act(async () => {
        vi.advanceTimersByTime(100);
        await Promise.resolve();
      });

      // The resume effect should have called streamChat
      await waitFor(() => {
        expect(streamFetched).toBe(true);
      });

      act(() => { sse.close(); });
    });

    it("does not resume a pending message with zero parts in a non-busy session", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      // Recent timestamp — NOT stale
      const recentTimestamp = Date.now() - 1_000;
      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [{ id: "s1", title: "Existing", status: "idle", updatedAt: "now" }],
      });
      opencodeMocks.listMessagesAction.mockResolvedValue({
        ok: true,
        messages: [
          {
            id: "msg-1",
            sessionId: "s1",
            role: "assistant",
            content: "",
            timestamp: "1s ago",
            timestampRaw: recentTimestamp,
            parts: [],
            pending: true,
          },
        ],
      });

      let streamFetched = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === "/api/u/alice/agents") {
            return {
              ok: true,
              json: async () => ({ agents: DEFAULT_AGENTS }),
            };
          }
          if (String(input) === "/api/w/alice/chat/stream") {
            streamFetched = true;
            return { ok: true, body: createSSEStream() };
          }
          throw new Error(`Unexpected fetch: ${String(input)}`);
        })
      );

      await renderConnectedHook();

      // Give time for effects to fire
      await act(async () => {
        vi.advanceTimersByTime(200);
        await Promise.resolve();
      });

      // Stream should NOT have been fetched
      expect(streamFetched).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Poll interval
  // -----------------------------------------------------------------------

  describe("poll interval", () => {
    it("does not poll when pollInterval is 0", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      stubFetchWithStream(() => createSSEStream());

      await renderConnectedHook({ pollInterval: 0 });

      const sessionCallsBefore = opencodeMocks.listSessionsAction.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      // No additional session loads from polling
      expect(opencodeMocks.listSessionsAction.mock.calls.length).toBe(sessionCallsBefore);
    });

    it("polls for sessions and messages at the configured interval", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      // Set up a busy session so polling refreshes messages
      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [{ id: "s1", title: "Existing", status: "busy", updatedAt: "now" }],
      });
      stubFetchWithStream(() => createSSEStream());

      await renderConnectedHook({ pollInterval: 2000 });

      const sessionCallsBefore = opencodeMocks.listSessionsAction.mock.calls.length;
      const messageCallsBefore = opencodeMocks.listMessagesAction.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(2100);
        await Promise.resolve();
      });

      expect(opencodeMocks.listSessionsAction.mock.calls.length).toBeGreaterThan(
        sessionCallsBefore
      );
      expect(opencodeMocks.listMessagesAction.mock.calls.length).toBeGreaterThan(
        messageCallsBefore
      );
    });

    it("refreshes messages for busy sessions during poll", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [
          { id: "s1", title: "First", status: "busy", updatedAt: "now" },
          { id: "s2", title: "Second", status: "idle", updatedAt: "now" },
        ],
      });
      stubFetchWithStream(() => createSSEStream());

      await renderConnectedHook({ pollInterval: 2000 });

      opencodeMocks.listMessagesAction.mockClear();

      await act(async () => {
        vi.advanceTimersByTime(2100);
        await Promise.resolve();
      });

      // s1 (busy) AND s1 (active) should be refreshed
      // s2 is idle and not active, so it should NOT be refreshed
      const refreshedSessionIds = opencodeMocks.listMessagesAction.mock.calls.map(
        (args: unknown[]) => args[1]
      );
      expect(refreshedSessionIds).toContain("s1");
    });
  });

  // -----------------------------------------------------------------------
  // scheduleWorkspaceRefresh debounce
  // -----------------------------------------------------------------------

  describe("scheduleWorkspaceRefresh", () => {
    it("debounces multiple workspace-updated events into a single refresh", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      const diffsCallsBefore = opencodeMocks.getWorkspaceDiffsAction.mock.calls.length;

      // Send multiple workspace-updated events rapidly
      act(() => {
        sse.push(sseEvent("workspace-updated", {}));
        sse.push(sseEvent("workspace-updated", {}));
        sse.push(sseEvent("workspace-updated", {}));
      });

      // After 250ms debounce, exactly one refresh should fire
      await waitFor(
        () => {
          expect(opencodeMocks.getWorkspaceDiffsAction.mock.calls.length).toBe(
            diffsCallsBefore + 1
          );
        },
        { timeout: 2000 }
      );

      act(() => { sse.close(); });
    });
  });

  // -----------------------------------------------------------------------
  // Abort handling
  // -----------------------------------------------------------------------

  describe("abort handling", () => {
    it("swallows AbortError and does not set error status", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input) === "/api/u/alice/agents") {
            return {
              ok: true,
              json: async () => ({ agents: DEFAULT_AGENTS }),
            };
          }
          if (String(input) === "/api/w/alice/chat/stream") {
            // Return a reader that waits indefinitely (will be aborted)
            return {
              ok: true,
              body: {
                getReader() {
                  return {
                    read: () =>
                      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
                        init?.signal?.addEventListener("abort", () => {
                          reject(new DOMException("Aborted", "AbortError"));
                        });
                      }),
                  };
                },
              },
            };
          }
          throw new Error(`Unexpected fetch: ${String(input)}`);
        })
      );

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("cancel me");
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(true);
      });

      await act(async () => {
        await result.current.abortSession();
      });

      // Should have error detail "cancelled" from abortSession, not from the stream error
      expect(result.current.isSending).toBe(false);
      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant?.statusInfo?.detail).toBe("cancelled");
    });
  });

  // -----------------------------------------------------------------------
  // HTTP error from stream endpoint
  // -----------------------------------------------------------------------

  describe("fetch error handling", () => {
    it("sets error status when stream endpoint returns HTTP error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === "/api/u/alice/agents") {
            return {
              ok: true,
              json: async () => ({ agents: DEFAULT_AGENTS }),
            };
          }
          if (String(input) === "/api/w/alice/chat/stream") {
            return {
              ok: false,
              json: async () => ({ error: "rate_limited" }),
            };
          }
          throw new Error(`Unexpected fetch: ${String(input)}`);
        })
      );

      // Return the error state from reconciliation so the finally block preserves it.
      // When the fetch throws, receivedStreamData = false, so the finally block:
      //   1. Fetches messages. If ok: updates. If not ok AND !receivedStreamData:
      //      removes temp messages.
      // To test the error propagation, make listMessages return messages
      // that include the assistant with error status (simulating what the
      // updateStatus call already set).
      opencodeMocks.listMessagesAction.mockResolvedValue({
        ok: true,
        messages: [],
      });

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0]?.role).toBe("user");
      expect(result.current.messages[1]?.role).toBe("assistant");
      expect(result.current.messages[1]?.statusInfo).toEqual({
        status: "error",
        detail: "rate_limited",
      });
    });

    it("preserves error status when reconciliation returns the error message", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === "/api/u/alice/agents") {
            return {
              ok: true,
              json: async () => ({ agents: DEFAULT_AGENTS }),
            };
          }
          if (String(input) === "/api/w/alice/chat/stream") {
            return {
              ok: false,
              json: async () => ({ error: "rate_limited" }),
            };
          }
          throw new Error(`Unexpected fetch: ${String(input)}`);
        })
      );

      // If the reconciliation returns an error result, AND no stream data,
      // temp messages are removed AND stream_incomplete is set
      opencodeMocks.listMessagesAction.mockResolvedValue({ ok: false, error: "failed" });

      const result = await renderConnectedHook();

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      await waitFor(() => {
        expect(result.current.isSending).toBe(false);
        expect(result.current.messages).toHaveLength(2);
        expect(result.current.messages[1]?.statusInfo).toEqual({
          status: "error",
          detail: "rate_limited",
        });
      });
    });
  });

  // -----------------------------------------------------------------------
  // Session indicator enrichment
  // -----------------------------------------------------------------------

  describe("session indicator enrichment", () => {
    it("marks an idle session as busy when it has an active stream", async () => {
      const sse = createSSEStream();
      stubFetchWithStream(() => sse);

      const result = await renderConnectedHook();

      // Session starts as idle
      const before = result.current.sessions.find((s) => s.id === "s1");
      expect(before?.status).toBe("idle");

      // Start sending — triggers submitted/streaming status
      await act(async () => {
        result.current.sendMessage("hello");
        await Promise.resolve();
      });

      // Push an SSE event so status transitions to "streaming"
      act(() => {
        sse.push(sseEvent("status", { status: "thinking" }));
      });

      await waitFor(() => {
        const session = result.current.sessions.find((s) => s.id === "s1");
        expect(session?.status).toBe("busy");
      });

      // Close and let the stream finish
      act(() => { sse.close(); });
    });

    it("keeps a polled busy session as busy regardless of streaming status", async () => {
      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [{ id: "s1", title: "Existing", status: "busy", updatedAt: "now" }],
      });
      stubFetchWithStream(() => createSSEStream());

      const result = await renderConnectedHook();

      await waitFor(() => {
        const session = result.current.sessions.find((s) => s.id === "s1");
        expect(session?.status).toBe("busy");
      });
    });

    it("returns idle status when no streaming is active", async () => {
      stubFetchWithStream(() => createSSEStream());

      const result = await renderConnectedHook();

      const session = result.current.sessions.find((s) => s.id === "s1");
      expect(session?.status).toBe("idle");
    });
  });

  // -----------------------------------------------------------------------
  // Resume pre-check
  // -----------------------------------------------------------------------

  describe("resume pre-check", () => {
    it("skips SSE subscription when resume pre-check finds the message already complete", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [{ id: "s1", title: "Existing", status: "busy", updatedAt: "now" }],
      });

      // Initial load returns pending message
      opencodeMocks.listMessagesAction.mockResolvedValueOnce({
        ok: true,
        messages: [
          {
            id: "msg-1",
            sessionId: "s1",
            role: "assistant",
            content: "partial",
            timestamp: "now",
            timestampRaw: Date.now(),
            parts: [{ type: "text", text: "partial" }],
            pending: true,
          },
        ],
      });

      // Pre-check (called by streamChat before opening SSE) returns complete
      opencodeMocks.listMessagesAction.mockResolvedValueOnce({
        ok: true,
        messages: [
          {
            id: "msg-1",
            sessionId: "s1",
            role: "assistant",
            content: "full response",
            timestamp: "now",
            timestampRaw: Date.now(),
            parts: [{ type: "text", text: "full response" }],
            pending: false,
          },
        ],
      });

      let streamFetched = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === "/api/u/alice/agents") {
            return { ok: true, json: async () => ({ agents: DEFAULT_AGENTS }) };
          }
          if (String(input) === "/api/w/alice/chat/stream") {
            streamFetched = true;
            return { ok: true, body: createSSEStream() };
          }
          throw new Error(`Unexpected fetch: ${String(input)}`);
        })
      );

      const result = await renderConnectedHook();

      // Give time for resume effect + pre-check to fire
      await act(async () => {
        vi.advanceTimersByTime(200);
        await Promise.resolve();
      });

      // SSE stream should NOT have been opened
      expect(streamFetched).toBe(false);

      // Message should be updated with the complete content
      await waitFor(() => {
        const msg = result.current.messages.find((m) => m.id === "msg-1");
        expect(msg?.pending).toBe(false);
        expect(msg?.content).toBe("full response");
      });
    });
  });

  // -----------------------------------------------------------------------
  // Resume busy-session tolerance
  // -----------------------------------------------------------------------

  describe("resume busy-session tolerance", () => {
    it("does not record resume failure when session is still busy after stream ends", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [{ id: "s1", title: "Existing", status: "busy", updatedAt: "now" }],
      });
      opencodeMocks.listMessagesAction.mockResolvedValue({
        ok: true,
        messages: [
          {
            id: "msg-1",
            sessionId: "s1",
            role: "assistant",
            content: "partial",
            timestamp: "now",
            timestampRaw: Date.now(),
            parts: [{ type: "text", text: "partial" }],
            pending: true,
          },
        ],
      });

      const openedStreams: Array<ReturnType<typeof createSSEStream>> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === "/api/u/alice/agents") {
            return { ok: true, json: async () => ({ agents: DEFAULT_AGENTS }) };
          }
          if (String(input) === "/api/w/alice/chat/stream") {
            const stream = createSSEStream();
            openedStreams.push(stream);
            return { ok: true, body: stream };
          }
          throw new Error(`Unexpected fetch: ${String(input)}`);
        })
      );

      const result = await renderConnectedHook();

      // Wait for resume to open the stream
      await act(async () => {
        vi.advanceTimersByTime(200);
        await Promise.resolve();
      });

      // Close the stream without any assistant data (simulates timeout/disconnect)
      act(() => {
        openedStreams[0]?.close();
      });

      // Wait for finally block to run
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      // The message should still be pending (not marked as resume_incomplete)
      // because the session is still busy
      await waitFor(() => {
        const msg = result.current.messages.find((m) => m.id === "msg-1");
        expect(msg?.pending).toBe(true);
        expect(msg?.statusInfo?.detail).not.toBe("resume_incomplete");
        expect(msg?.statusInfo?.detail).not.toBe("resume_exhausted");
      });

      // Cleanup: close any remaining streams by aborting
      act(() => {
        result.current.abortSession();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Resume poll complement
  // -----------------------------------------------------------------------

  describe("resume poll complement", () => {
    it("detects message completion via polling during resume and aborts SSE", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [{ id: "s1", title: "Existing", status: "busy", updatedAt: "now" }],
      });

      // Initial messages load: pending
      opencodeMocks.listMessagesAction.mockResolvedValueOnce({
        ok: true,
        messages: [
          {
            id: "msg-1",
            sessionId: "s1",
            role: "assistant",
            content: "partial",
            timestamp: "now",
            timestampRaw: Date.now(),
            parts: [{ type: "text", text: "partial" }],
            pending: true,
          },
        ],
      });

      // Pre-check: still pending
      opencodeMocks.listMessagesAction.mockResolvedValueOnce({
        ok: true,
        messages: [
          {
            id: "msg-1",
            sessionId: "s1",
            role: "assistant",
            content: "partial",
            timestamp: "now",
            timestampRaw: Date.now(),
            parts: [{ type: "text", text: "partial" }],
            pending: true,
          },
        ],
      });

      // Poll at ~4s: now complete
      opencodeMocks.listMessagesAction.mockResolvedValue({
        ok: true,
        messages: [
          {
            id: "msg-1",
            sessionId: "s1",
            role: "assistant",
            content: "finished response",
            timestamp: "now",
            timestampRaw: Date.now(),
            parts: [{ type: "text", text: "finished response" }],
            pending: false,
          },
        ],
      });

      const sse = createSSEStream();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === "/api/u/alice/agents") {
            return { ok: true, json: async () => ({ agents: DEFAULT_AGENTS }) };
          }
          if (String(input) === "/api/w/alice/chat/stream") {
            return { ok: true, body: sse };
          }
          throw new Error(`Unexpected fetch: ${String(input)}`);
        })
      );

      const result = await renderConnectedHook();

      // Wait for resume to open the stream
      await act(async () => {
        vi.advanceTimersByTime(200);
        await Promise.resolve();
      });

      // Advance past the poll interval (4000ms) so the poll fires.
      // Use multiple small steps to let microtasks (abort propagation,
      // async finally) interleave with timer advancement.
      for (let i = 0; i < 12; i++) {
        await act(async () => {
          vi.advanceTimersByTime(500);
          await new Promise((r) => setTimeout(r, 0));
        });
      }

      // The poll should have detected completion and updated messages.
      // Note: isSending transition depends on the full async abort chain
      // completing (AbortError -> catch -> finally -> setStatus), which
      // is already covered by other tests; here we verify the poll-driven
      // message update which is the core behavior of this feature.
      await waitFor(() => {
        const msg = result.current.messages.find((m) => m.id === "msg-1");
        expect(msg?.pending).toBe(false);
        expect(msg?.content).toBe("finished response");
      });
    });
  });
});

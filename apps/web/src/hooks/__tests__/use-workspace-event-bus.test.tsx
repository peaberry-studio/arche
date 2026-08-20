/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceEventBus } from "@/hooks/workspace/use-workspace-event-bus";
import { isSending } from "@/lib/opencode/event-reducer";

const opencodeMocks = vi.hoisted(() => ({
  listMessagesAction: vi.fn(),
  listPermissionsAction: vi.fn(),
}));

vi.mock("@/actions/opencode", () => ({
  listMessagesAction: opencodeMocks.listMessagesAction,
  listPermissionsAction: opencodeMocks.listPermissionsAction,
}));

const encoder = new TextEncoder();

type ControlledEventStream = {
  stream: ReadableStream<Uint8Array>;
  sendEvent: (event: Record<string, unknown>) => void;
  sendRaw: (raw: string) => void;
  end: () => void;
};

function createEventStream(): ControlledEventStream {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    sendEvent(event: Record<string, unknown>) {
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    sendRaw(raw: string) {
      controller?.enqueue(encoder.encode(raw));
    },
    end() {
      controller?.close();
    },
  };
}

function sseResponse(stream: ControlledEventStream) {
  return { ok: true, body: stream.stream };
}

function busyEvent(sessionId: string) {
  return {
    type: "session.status",
    properties: { sessionID: sessionId, status: { type: "busy" } },
  };
}

function idleEvent(sessionId: string) {
  return {
    type: "session.status",
    properties: { sessionID: sessionId, status: { type: "idle" } },
  };
}

describe("useWorkspaceEventBus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    opencodeMocks.listMessagesAction.mockResolvedValue({ ok: true, messages: [] });
    opencodeMocks.listPermissionsAction.mockResolvedValue({ ok: true, permissions: {} });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function renderBus(
    options: Partial<Parameters<typeof useWorkspaceEventBus>[0]> = {},
  ) {
    const refreshDiffs = options.refreshDiffs ?? vi.fn();
    const refreshFiles = options.refreshFiles ?? vi.fn(async () => undefined);
    const onBackgroundSessionIdle = options.onBackgroundSessionIdle ?? vi.fn();
    const hook = renderHook(() =>
      useWorkspaceEventBus({
        slug: "alice",
        getActiveSessionId: options.getActiveSessionId ?? (() => "s1"),
        getSessions: options.getSessions ?? (() => []),
        refreshDiffs,
        refreshFiles,
        onBackgroundSessionIdle,
      }),
    );
    return { hook, refreshDiffs, refreshFiles, onBackgroundSessionIdle };
  }

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("applies bus events to the store and ignores heartbeat comments", async () => {
    const stream = createEventStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(stream)),
    );

    const { hook } = renderBus();
    await flush();
    expect(hook.result.current.isBusConnected).toBe(true);

    // Heartbeats are SSE comments; they must never dispatch.
    await act(async () => {
      stream.sendRaw(": heartbeat 1724160000000\n\n");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.sessionStatus).toEqual({});
    expect(hook.result.current.store.messages.s1 ?? []).toEqual([]);

    await act(async () => {
      stream.sendEvent(busyEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(isSending(hook.result.current.store, "s1")).toBe(true);

    await act(async () => {
      stream.sendEvent({
        type: "message.updated",
        properties: {
          info: {
            id: "m1",
            role: "assistant",
            sessionID: "s1",
            time: { created: 1 },
            parts: [{ type: "text", text: "Hola" }],
          },
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.messages.s1?.[0]?.content).toBe("Hola");

    await act(async () => {
      stream.sendEvent({
        type: "permission.asked",
        properties: {
          permission: { id: "perm-1", sessionID: "s1", permission: "Edit file", pattern: "Edit(*)" },
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.permissions.s1?.[0]).toMatchObject({
      id: "perm-1",
      sessionId: "s1",
      title: "Edit file",
    });
  });

  it("ignores malformed event payloads without breaking the loop", async () => {
    const stream = createEventStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(stream)),
    );

    const { hook } = renderBus();
    await flush();

    await act(async () => {
      stream.sendRaw("data: not-json{\n\n");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.isBusConnected).toBe(true);

    // The loop survives and keeps applying well-formed events.
    await act(async () => {
      stream.sendEvent(busyEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(isSending(hook.result.current.store, "s1")).toBe(true);
  });

  it("hydrates the active session on connect and on every reconnect after EOF", async () => {
    const first = createEventStream();
    const second = createEventStream();
    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCalls += 1;
        return sseResponse(fetchCalls === 1 ? first : second);
      }),
    );

    const { hook } = renderBus();
    await flush();

    // Hydrate on the initial connect.
    expect(fetchCalls).toBe(1);
    expect(opencodeMocks.listMessagesAction).toHaveBeenCalledTimes(1);
    expect(opencodeMocks.listMessagesAction).toHaveBeenCalledWith("alice", "s1");

    // Clean EOF counts as a disconnect: back off, reconnect, hydrate again.
    await act(async () => {
      first.end();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.isBusConnected).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchCalls).toBe(2);
    expect(hook.result.current.isBusConnected).toBe(true);
    expect(opencodeMocks.listMessagesAction).toHaveBeenCalledTimes(2);
    expect(opencodeMocks.listPermissionsAction).toHaveBeenCalledTimes(2);
    expect(opencodeMocks.listPermissionsAction).toHaveBeenCalledWith("alice");
  });

  it("applies every store mutation when multiple SSE events arrive in one chunk", async () => {
    const stream = createEventStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(stream)),
    );

    const { hook } = renderBus();
    await flush();

    const messageUpdated = {
      type: "message.updated",
      properties: {
        info: {
          id: "m1",
          role: "assistant",
          sessionID: "s1",
          time: { created: 1 },
          parts: [],
        },
      },
    };
    const partUpdated = {
      type: "message.part.updated",
      properties: {
        part: { id: "p1", type: "text", text: "Hola", messageID: "m1", sessionID: "s1" },
      },
    };

    await act(async () => {
      stream.sendRaw(
        `data: ${JSON.stringify(messageUpdated)}\n\n` +
          `data: ${JSON.stringify(partUpdated)}\n\n` +
          `data: ${JSON.stringify(busyEvent("s1"))}\n\n`,
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(hook.result.current.store.messages.s1?.[0]?.id).toBe("m1");
    expect(hook.result.current.store.messages.s1?.[0]?.parts).toMatchObject([
      { type: "text", text: "Hola" },
    ]);
    expect(isSending(hook.result.current.store, "s1")).toBe(true);
  });

  it("hydrates permissions and session status on connect and reconnect", async () => {
    const first = createEventStream();
    const second = createEventStream();
    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCalls += 1;
        return sseResponse(fetchCalls === 1 ? first : second);
      }),
    );

    opencodeMocks.listMessagesAction.mockResolvedValue({
      ok: true,
      messages: [],
      sessionRuntimeStatus: "busy",
    });
    opencodeMocks.listPermissionsAction.mockResolvedValue({
      ok: true,
      permissions: {
        s1: [{ id: "perm-1", sessionId: "s1", title: "Edit file", state: "pending" }],
      },
    });

    const { hook } = renderBus();
    await flush();

    expect(hook.result.current.store.permissions.s1?.[0]).toMatchObject({
      id: "perm-1",
      sessionId: "s1",
    });
    expect(isSending(hook.result.current.store, "s1")).toBe(true);

    opencodeMocks.listMessagesAction.mockResolvedValue({
      ok: true,
      messages: [],
      sessionRuntimeStatus: "idle",
    });
    opencodeMocks.listPermissionsAction.mockResolvedValue({
      ok: true,
      permissions: {},
    });

    await act(async () => {
      first.end();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(opencodeMocks.listPermissionsAction).toHaveBeenCalledTimes(2);
    expect(hook.result.current.store.permissions.s1 ?? []).toHaveLength(0);
    expect(isSending(hook.result.current.store, "s1")).toBe(false);
  });

  it("keeps isSending busy while the bus is down when the last known status was busy", async () => {
    const stream = createEventStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(stream)),
    );

    const { hook } = renderBus();
    await flush();

    await act(async () => {
      stream.sendEvent(busyEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(isSending(hook.result.current.store, "s1")).toBe(true);

    // Bus dies mid-turn. OpenCode is still the truth: the store must keep the
    // last known busy status instead of guessing idle from the pipe state.
    await act(async () => {
      stream.end();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.isBusConnected).toBe(false);
    expect(isSending(hook.result.current.store, "s1")).toBe(true);
  });

  it("clears isSending on session.status idle even while the reader stays open", async () => {
    const stream = createEventStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(stream)),
    );

    const { hook } = renderBus();
    await flush();

    await act(async () => {
      stream.sendEvent(busyEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(isSending(hook.result.current.store, "s1")).toBe(true);

    // The composer follows OpenCode, not the HTTP lifecycle: idle arrives and
    // the reader never closes.
    await act(async () => {
      stream.sendEvent(idleEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(isSending(hook.result.current.store, "s1")).toBe(false);
    expect(hook.result.current.isBusConnected).toBe(true);
  });

  it("debounces workspace refreshes for file/todo events", async () => {
    const stream = createEventStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(stream)),
    );

    const { refreshDiffs, refreshFiles } = renderBus();
    await flush();

    await act(async () => {
      stream.sendEvent({ type: "todo.updated", properties: { sessionID: "s1" } });
      stream.sendEvent({ type: "file.edited", properties: { sessionID: "s1" } });
      stream.sendEvent({ type: "todo.updated", properties: { sessionID: "s1" } });
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(refreshDiffs).not.toHaveBeenCalled();
    expect(refreshFiles).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refreshDiffs).toHaveBeenCalledTimes(1);
    expect(refreshFiles).toHaveBeenCalledTimes(1);
  });

  it("fires onBackgroundSessionIdle when a non-active session turns idle", async () => {
    const stream = createEventStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(stream)),
    );

    const { onBackgroundSessionIdle } = renderBus({
      onBackgroundSessionIdle: vi.fn(),
    });
    await flush();

    await act(async () => {
      stream.sendEvent(busyEvent("s2"));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      stream.sendEvent(idleEvent("s2"));
      await vi.advanceTimersByTimeAsync(0);
    });
    // The active session's own transitions must not fire the callback.
    await act(async () => {
      stream.sendEvent(busyEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      stream.sendEvent(idleEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onBackgroundSessionIdle).toHaveBeenCalledTimes(1);
    expect(onBackgroundSessionIdle).toHaveBeenCalledWith("s2");
  });
});

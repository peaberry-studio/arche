/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceEventBus } from "@/hooks/workspace/use-workspace-event-bus";
import { isSending } from "@/lib/workspace-events/reducer";
import type { WorkspaceMessage } from "@/types/workspace-runtime";

const opencodeMocks = vi.hoisted(() => ({
  listMessagesAction: vi.fn(),
  listPermissionsAction: vi.fn(),
}));

vi.mock("@/actions/workspace-sessions", () => ({
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
    v: 1, type: "session.status", sessionId, status: "busy",
  };
}

function idleEvent(sessionId: string) {
  return {
    v: 1, type: "session.status", sessionId, status: "idle",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function snapshotMessage(content: string, sessionId = "s1"): WorkspaceMessage {
  return { id: "m1", sessionId, role: "assistant", content, timestamp: "now", parts: [{ type: "text", id: "part-1", text: content }] };
}

type MessageSnapshot = {
  ok: boolean;
  messages: WorkspaceMessage[];
  archived?: boolean;
  sessionRuntimeStatus: "busy" | "idle";
};

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
    const onKnowledgeProposalsChanged =
      options.onKnowledgeProposalsChanged ?? vi.fn();
    const hook = renderHook(({ slug }) =>
      useWorkspaceEventBus({
        slug,
        getActiveSessionId: options.getActiveSessionId ?? (() => "s1"),
        getSessions: options.getSessions ?? (() => []),
        refreshDiffs,
        refreshFiles,
        onBackgroundSessionIdle,
        onKnowledgeProposalsChanged,
        syncRuntimeMetadataForSession: options.syncRuntimeMetadataForSession,
      }),
      { initialProps: { slug: "alice" } },
    );
    return {
      hook,
      refreshDiffs,
      refreshFiles,
      onBackgroundSessionIdle,
      onKnowledgeProposalsChanged,
    };
  }

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("requests the versioned Arche protocol on the event stream", async () => {
    const stream = createEventStream();
    const fetch = vi.fn(async () => sseResponse(stream));
    vi.stubGlobal("fetch", fetch);
    renderBus();
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/w/alice/events?protocol=arche-v1", expect.objectContaining({ signal: expect.anything() }));
  });

  it.each(["commit", "patch"] as const)("prunes orphan %s events when an unhydrated background session becomes idle", async (mode) => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    const { hook } = renderBus();
    await flush();
    await act(async () => {
      for (let i = 0; i < 25; i++) {
        const sessionId = `background-${i}`;
        const messageId = `orphan-${i}`;
        hook.result.current.dispatchReducerEvent({ v: 1, type: "part.upserted", sessionId, messageId, part: { type: "text", id: "text", text: "Partial response" } });
        hook.result.current.dispatchReducerEvent(mode === "commit"
          ? { v: 1, type: "message.upserted", mode, sessionId, messageId, timestamp: "", timestampRaw: 1 }
          : { v: 1, type: "message.upserted", mode, sessionId, messageId, patch: { completedAt: 1 } });
        hook.result.current.dispatchReducerEvent({ v: 1, type: "session.status", sessionId, status: "idle" });
      }
    });
    expect(hook.result.current.store.pendingUpdates).toEqual({});
    expect(hook.result.current.store.pendingParts).toEqual({});
  });

  it("retains updates through idle until the in-flight snapshot supplies tool identity", async () => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    const snapshot = deferred<MessageSnapshot>();
    opencodeMocks.listMessagesAction.mockReturnValue(snapshot.promise);
    const { hook } = renderBus();
    await flush();
    await act(async () => {
      hook.result.current.dispatchReducerEvent({ v: 1, type: "part.upserted", mode: "tool-patch", sessionId: "s1", messageId: "m1", update: { id: "call", status: "completed", output: "Final file contents" } });
      hook.result.current.dispatchReducerEvent({ v: 1, type: "session.status", sessionId: "s1", status: "idle" });
    });
    expect(hook.result.current.store.pendingUpdates?.m1).toHaveLength(1);
    await act(async () => {
      snapshot.resolve({ ok: true, sessionRuntimeStatus: "busy", messages: [{
        id: "m1", sessionId: "s1", role: "assistant", content: "", timestamp: "", parts: [
          { type: "tool", id: "call", name: "read", state: { status: "running", input: { path: "note.md" } } },
        ],
      }] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.messages.s1[0].parts).toMatchObject([{ state: { status: "completed", output: "Final file contents" } }]);
    expect(hook.result.current.store.pendingUpdates).toEqual({});
    expect(hook.result.current.store.sessionStatus.s1).toBe("idle");
  });

  it("clears compaction deliveries absent from the completed snapshot", async () => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    const snapshot = deferred<MessageSnapshot>();
    opencodeMocks.listMessagesAction.mockReturnValue(snapshot.promise);
    const { hook } = renderBus();
    await flush();
    await act(async () => {
      hook.result.current.dispatchReducerEvent({ v: 1, type: "message.upserted", mode: "commit", sessionId: "s1", messageId: "compaction", timestamp: "", timestampRaw: 1 });
      hook.result.current.dispatchReducerEvent({ v: 1, type: "session.status", sessionId: "s1", status: "idle" });
      snapshot.resolve({ ok: true, messages: [], sessionRuntimeStatus: "idle" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.pendingUpdates).toEqual({});
  });

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
        v: 1, type: "message.upserted",
          message: {
            id: "m1",
            role: "assistant",
            sessionId: "s1", timestamp: "", timestampRaw: 1, content: "Hola",
            parts: [{ type: "text", text: "Hola" }],
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.messages.s1?.[0]?.content).toBe("Hola");

    await act(async () => {
      stream.sendEvent({
        v: 1, type: "permission.asked",
        permission: { id: "perm-1", sessionId: "s1", title: "Edit file", pattern: "Edit(*)", state: "pending" },
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
      stream.sendEvent({ v: 1, type: "future.event" });
      stream.sendEvent({ v: 2, type: "session.status", sessionId: "s1", status: "busy" });
      stream.sendEvent({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.isBusConnected).toBe(true);
    expect(hook.result.current.store.sessionStatus).toEqual({});

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

  it("keeps archived snapshots read-only across reconnects and ignores colliding live events", async () => {
    const first = createEventStream();
    const second = createEventStream();
    const fetch = vi.fn().mockResolvedValueOnce(sseResponse(first)).mockResolvedValue(sseResponse(second));
    vi.stubGlobal("fetch", fetch);
    const message = { id: "m1", sessionId: "s1", role: "assistant", content: "Archived response", timestamp: "now", parts: [{ type: "text", text: "Archived response" }] };
    opencodeMocks.listMessagesAction.mockResolvedValue({ ok: true, archived: true, messages: [message], sessionRuntimeStatus: "idle" });
    const { hook } = renderBus({ getSessions: () => [{ id: "s1", title: "Archive", status: "idle", updatedAt: "now", archived: true }] });
    await flush();
    await act(async () => {
      first.sendEvent(busyEvent("s1"));
      first.sendEvent({ v: 1, type: "message.removed", messageId: "m1" });
      first.sendEvent({ v: 1, type: "permission.asked", permission: { id: "p1", sessionId: "s1", title: "Edit", state: "pending" } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.messages.s1).toEqual([message]);
    expect(isSending(hook.result.current.store, "s1")).toBe(false);
    expect(hook.result.current.store.permissions.s1 ?? []).toEqual([]);
    await act(async () => { first.end(); await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(opencodeMocks.listMessagesAction).toHaveBeenCalledTimes(2);
    expect(hook.result.current.store.messages.s1).toEqual([message]);
    expect(isSending(hook.result.current.store, "s1")).toBe(false);
  });

  it("discards an older live hydration completing after a newer archived snapshot", async () => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    const older = deferred<MessageSnapshot>();
    opencodeMocks.listMessagesAction.mockReturnValueOnce(older.promise);
    const syncRuntimeMetadataForSession = vi.fn();
    const { hook } = renderBus({ syncRuntimeMetadataForSession });
    await flush();
    const archived = snapshotMessage("Archived");
    opencodeMocks.listMessagesAction.mockResolvedValueOnce({ ok: true, archived: true, messages: [archived], sessionRuntimeStatus: "idle" });
    await act(async () => { await hook.result.current.refreshMessages(); });
    await act(async () => {
      older.resolve({ ok: true, messages: [snapshotMessage("Stale live response")], sessionRuntimeStatus: "busy" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.messages.s1).toEqual([archived]);
    expect(hook.result.current.store.sessionStatus.s1).toBe("idle");
    expect(syncRuntimeMetadataForSession).not.toHaveBeenCalled();
  });

  it("fences events and late permission hydration immediately without a refreshed sessions list", async () => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    const permissions = deferred<{ ok: boolean; permissions: Record<string, unknown[]> }>();
    opencodeMocks.listPermissionsAction.mockReturnValueOnce(permissions.promise);
    const archived = snapshotMessage("Archived");
    opencodeMocks.listMessagesAction.mockResolvedValue({ ok: true, archived: true, messages: [archived], sessionRuntimeStatus: "idle" });
    const { hook } = renderBus({ getSessions: () => [] });
    await flush();
    await act(async () => {
      stream.sendEvent(busyEvent("s1"));
      stream.sendEvent({ v: 1, type: "part.delta", messageId: "m1", partId: "part-1", field: "text", delta: "corrupted" });
      stream.sendEvent({ v: 1, type: "message.upserted", message: { ...snapshotMessage("Live"), id: "m2" } });
      stream.sendEvent({ v: 1, type: "permission.asked", permission: { id: "p1", sessionId: "s1", title: "Edit", state: "pending" } });
      stream.sendEvent({ v: 1, type: "session.removed", sessionId: "s1" });
      permissions.resolve({ ok: true, permissions: { s1: [{ id: "late", sessionId: "s1", title: "Edit", state: "pending" }] } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.messages.s1).toEqual([archived]);
    expect(hook.result.current.store.sessionStatus.s1).toBe("idle");
    expect(hook.result.current.store.permissions.s1 ?? []).toEqual([]);
  });

  it.each([false, undefined])("unfreezes a newer live rollback snapshot with archived=%s despite a stale archive list", async (archived) => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    opencodeMocks.listMessagesAction.mockResolvedValueOnce({ ok: true, archived: true, messages: [snapshotMessage("Long archived response")], sessionRuntimeStatus: "idle" });
    const { hook } = renderBus({ getSessions: () => [{ id: "s1", title: "Archive", status: "idle", updatedAt: "now", archived: true }] });
    await flush();
    const live = snapshotMessage("Live");
    opencodeMocks.listMessagesAction.mockResolvedValueOnce({ ok: true, archived, messages: [live], sessionRuntimeStatus: "idle" });
    await act(async () => { await hook.result.current.refreshMessages(); });
    expect(hook.result.current.store.messages.s1).toEqual([live]);
    await act(async () => {
      stream.sendEvent(busyEvent("s1"));
      stream.sendEvent({ v: 1, type: "part.delta", sessionId: "s1", messageId: "m1", partId: "part-1", field: "text", delta: " again" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.sessionStatus.s1).toBe("busy");
    expect(hook.result.current.store.messages.s1[0].content).toBe("Live again");
  });

  it("keeps request generations independent across sessions", async () => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    const first = deferred<MessageSnapshot>();
    opencodeMocks.listMessagesAction.mockReturnValueOnce(first.promise);
    const { hook } = renderBus();
    await flush();
    const second = snapshotMessage("Second session", "s2");
    opencodeMocks.listMessagesAction.mockResolvedValueOnce({ ok: true, archived: true, messages: [second], sessionRuntimeStatus: "idle" });
    await act(async () => { await hook.result.current.refreshMessages("s2"); });
    const firstMessage = snapshotMessage("First session");
    await act(async () => {
      first.resolve({ ok: true, messages: [firstMessage], sessionRuntimeStatus: "busy" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.messages.s1).toEqual([firstMessage]);
    expect(hook.result.current.store.messages.s2).toEqual([second]);
    expect(hook.result.current.store.sessionStatus).toEqual({ s1: "busy", s2: "idle" });
  });

  it("clears loading when a session with pending hydration is removed and discards its late snapshot", async () => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    const pending = deferred<MessageSnapshot>();
    opencodeMocks.listMessagesAction.mockReturnValueOnce(pending.promise);
    const { hook } = renderBus();
    await flush();
    expect(hook.result.current.isLoadingMessages).toBe(true);

    act(() => { hook.result.current.removeSessionEntries(new Set(["s1"])); });
    expect(hook.result.current.isLoadingMessages).toBe(false);
    await act(async () => {
      pending.resolve({ ok: true, archived: true, messages: [snapshotMessage("Removed archive")], sessionRuntimeStatus: "idle" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.messages).toEqual({});
    expect(hook.result.current.isLoadingMessages).toBe(false);
  });

  it.each(["remove", "complete"])("keeps loading another session when the first hydration is %s", async (operation) => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    const first = deferred<MessageSnapshot>();
    const second = deferred<MessageSnapshot>();
    opencodeMocks.listMessagesAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { hook } = renderBus();
    await flush();
    let refresh!: Promise<void>;
    act(() => { refresh = hook.result.current.refreshMessages("s2"); });

    await act(async () => {
      if (operation === "remove") hook.result.current.removeSessionEntries(new Set(["s1"]));
      first.resolve({ ok: true, messages: [snapshotMessage("First")], sessionRuntimeStatus: "idle" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.isLoadingMessages).toBe(true);
    await act(async () => {
      second.resolve({ ok: true, messages: [snapshotMessage("Second", "s2")], sessionRuntimeStatus: "idle" });
      await refresh;
    });
    expect(hook.result.current.isLoadingMessages).toBe(false);
    expect(hook.result.current.store.messages.s2?.[0].content).toBe("Second");
  });

  it("does not let an invalidated request clear a newer hydration for the same session", async () => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    const older = deferred<MessageSnapshot>();
    const newer = deferred<MessageSnapshot>();
    opencodeMocks.listMessagesAction.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { hook } = renderBus();
    await flush();
    let refresh!: Promise<void>;
    act(() => {
      hook.result.current.removeSessionEntries(new Set(["s1"]));
      refresh = hook.result.current.refreshMessages();
    });
    await act(async () => {
      older.resolve({ ok: true, messages: [snapshotMessage("Stale")], sessionRuntimeStatus: "busy" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.isLoadingMessages).toBe(true);
    await act(async () => {
      newer.resolve({ ok: true, messages: [snapshotMessage("Current")], sessionRuntimeStatus: "idle" });
      await refresh;
    });
    expect(hook.result.current.isLoadingMessages).toBe(false);
    expect(hook.result.current.store.messages.s1?.[0].content).toBe("Current");
  });

  it("does not re-freeze a rollback when an older archived hydration finishes late", async () => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    const older = deferred<MessageSnapshot>();
    opencodeMocks.listMessagesAction.mockReturnValueOnce(older.promise);
    const { hook } = renderBus();
    await flush();
    const live = snapshotMessage("Live rollback");
    opencodeMocks.listMessagesAction.mockResolvedValueOnce({ ok: true, archived: false, messages: [live], sessionRuntimeStatus: "idle" });
    await act(async () => { await hook.result.current.refreshMessages(); });
    await act(async () => {
      older.resolve({ ok: true, archived: true, messages: [snapshotMessage("Old archive")], sessionRuntimeStatus: "idle" });
      await vi.advanceTimersByTimeAsync(0);
      stream.sendEvent(busyEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.messages.s1).toEqual([live]);
    expect(hook.result.current.store.sessionStatus.s1).toBe("busy");
  });

  it("honors a later archive list after the rollback list has caught up", async () => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));
    let listedArchived = true;
    opencodeMocks.listMessagesAction.mockResolvedValueOnce({ ok: true, archived: true, messages: [snapshotMessage("Archive")], sessionRuntimeStatus: "idle" });
    const { hook } = renderBus({ getSessions: () => [{ id: "s1", title: "Session", status: "idle", updatedAt: "now", archived: listedArchived }] });
    await flush();
    opencodeMocks.listMessagesAction.mockResolvedValueOnce({ ok: true, archived: false, messages: [snapshotMessage("Rollback")], sessionRuntimeStatus: "idle" });
    await act(async () => { await hook.result.current.refreshMessages(); });
    listedArchived = false;
    await act(async () => {
      stream.sendEvent(busyEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.sessionStatus.s1).toBe("busy");
    listedArchived = true;
    await act(async () => {
      stream.sendEvent(idleEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.sessionStatus.s1).toBe("busy");
  });

  it("resets archive recognition on slug changes and ignores the old workspace's pending hydration and events", async () => {
    const first = createEventStream();
    const second = createEventStream();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(sseResponse(first)).mockResolvedValue(sseResponse(second)));
    opencodeMocks.listMessagesAction.mockResolvedValueOnce({ ok: true, archived: true, messages: [snapshotMessage("Alice archive")], sessionRuntimeStatus: "idle" });
    const { hook } = renderBus();
    await flush();
    const pending = deferred<MessageSnapshot>();
    opencodeMocks.listMessagesAction.mockReturnValueOnce(pending.promise);
    let pendingRefresh!: Promise<void>;
    act(() => { pendingRefresh = hook.result.current.refreshMessages(); });
    const bobMessage = snapshotMessage("Bob live");
    opencodeMocks.listMessagesAction.mockResolvedValueOnce({ ok: true, messages: [bobMessage], sessionRuntimeStatus: "idle" });
    hook.rerender({ slug: "bob" });
    await flush();
    await act(async () => {
      pending.resolve({ ok: true, archived: true, messages: [snapshotMessage("Alice late archive")], sessionRuntimeStatus: "idle" });
      await pendingRefresh;
      first.sendEvent({ v: 1, type: "message.upserted", message: snapshotMessage("Alice event") });
      second.sendEvent(busyEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(opencodeMocks.listMessagesAction).toHaveBeenLastCalledWith("bob", "s1");
    expect(hook.result.current.store.messages.s1).toEqual([bobMessage]);
    expect(hook.result.current.store.sessionStatus.s1).toBe("busy");
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
      v: 1, type: "message.upserted",
        message: {
          id: "m1",
          role: "assistant",
          sessionId: "s1", timestamp: "", timestampRaw: 1, content: "",
          parts: [],
      },
    };
    const partUpdated = {
      v: 1, type: "part.upserted", messageId: "m1", sessionId: "s1",
      part: { id: "p1", type: "text", text: "Hola" },
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
      stream.sendEvent({ v: 1, type: "workspace.touched" });
      stream.sendEvent({ v: 1, type: "workspace.touched" });
      stream.sendEvent({ v: 1, type: "workspace.touched" });
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

  it("coalesces a knowledge.proposals_changed burst into one callback without touching the store", async () => {
    const stream = createEventStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(stream)),
    );

    const { hook, onKnowledgeProposalsChanged } = renderBus({
      onKnowledgeProposalsChanged: vi.fn(),
    });
    await flush();

    const storeBefore = hook.result.current.store;
    await act(async () => {
      stream.sendEvent({ v: 1, type: "knowledge.proposals_changed" });
      stream.sendEvent({ v: 1, type: "knowledge.proposals_changed" });
      stream.sendEvent({ v: 1, type: "knowledge.proposals_changed" });
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(onKnowledgeProposalsChanged).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onKnowledgeProposalsChanged).toHaveBeenCalledTimes(1);

    // The notification never reaches the reducer: no session status, messages,
    // or permissions state may change because of it.
    expect(hook.result.current.store.sessionStatus).toEqual({});
    expect(hook.result.current.store.messages.s1 ?? []).toEqual([]);
    expect(hook.result.current.store.permissions).toEqual({});
    expect(hook.result.current.store).toBe(storeBefore);
  });

  it("fires the knowledge proposals callback on reconnect and keeps reducing runtime events", async () => {
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

    const { hook, onKnowledgeProposalsChanged } = renderBus({
      onKnowledgeProposalsChanged: vi.fn(),
    });
    await flush();
    // The initial connect schedules one deferred count refresh.
    expect(opencodeMocks.listMessagesAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.end();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    // Connect-1's debounce fired, and the reconnect hydrated again.
    expect(onKnowledgeProposalsChanged).toHaveBeenCalledTimes(1);
    expect(onKnowledgeProposalsChanged).not.toHaveBeenCalledWith(expect.anything());
    expect(opencodeMocks.listMessagesAction).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.sendEvent(busyEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    // Runtime events are unaffected by the notification pipeline.
    expect(isSending(hook.result.current.store, "s1")).toBe(true);
  });

  it("refreshes the pending count when a notification lands mid-conversation without disturbing streaming parts", async () => {
    const stream = createEventStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(stream)),
    );

    const { hook, onKnowledgeProposalsChanged } = renderBus({
      onKnowledgeProposalsChanged: vi.fn(),
    });
    await flush();

    await act(async () => {
      stream.sendEvent(busyEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      stream.sendEvent({ v: 1, type: "knowledge.proposals_changed" });
      stream.sendEvent({
        v: 1, type: "part.upserted", messageId: "m1", sessionId: "s1",
        part: { id: "p1", type: "text", text: "Hola" },
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    // Streaming continues normally while the badge refresh is still debounced.
    expect(isSending(hook.result.current.store, "s1")).toBe(true);
    expect(onKnowledgeProposalsChanged).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    // The notification burst coalesced with the still-pending connect refresh:
    // a single fetch ran after everything settled.
    expect(onKnowledgeProposalsChanged).toHaveBeenCalledTimes(1);
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

  it("does not clobber live busy with a stale idle hydrate snapshot", async () => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));

    let resolveHydrate: (value: {
      ok: boolean;
      messages: unknown[];
      sessionRuntimeStatus: "idle" | "busy";
    }) => void = () => undefined;
    opencodeMocks.listMessagesAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHydrate = resolve;
        }),
    );

    const { hook } = renderBus();
    await flush();

    await act(async () => {
      stream.sendEvent(busyEvent("s1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(isSending(hook.result.current.store, "s1")).toBe(true);

    await act(async () => {
      resolveHydrate({ ok: true, messages: [], sessionRuntimeStatus: "idle" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(isSending(hook.result.current.store, "s1")).toBe(true);
  });

  it("keeps a permission.asked that arrives while hydrate is in flight", async () => {
    const stream = createEventStream();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));

    let resolvePermissions: (value: {
      ok: boolean;
      permissions: Record<string, unknown[]>;
    }) => void = () => undefined;
    opencodeMocks.listPermissionsAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePermissions = resolve;
        }),
    );

    const { hook } = renderBus();
    await flush();

    await act(async () => {
      stream.sendEvent({
        v: 1, type: "permission.asked",
        permission: { id: "perm-live", sessionId: "s1", title: "Edit file", state: "pending" },
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.permissions.s1?.[0]?.id).toBe("perm-live");

    await act(async () => {
      resolvePermissions({ ok: true, permissions: {} });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.store.permissions.s1).toMatchObject([
      { id: "perm-live", sessionId: "s1" },
    ]);
  });
});

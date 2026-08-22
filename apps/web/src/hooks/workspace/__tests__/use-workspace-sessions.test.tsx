/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceSessions } from "@/hooks/workspace/use-workspace-sessions";
import type { WorkspaceSession } from "@/lib/opencode/types";

const opencodeMocks = vi.hoisted(() => ({
  createSessionAction: vi.fn(),
  deleteSessionAction: vi.fn(),
  listSessionFamilyAction: vi.fn(),
  listSessionsAction: vi.fn(),
  markFlowRunSeenAction: vi.fn(),
  updateSessionAction: vi.fn(),
}));

vi.mock("@/actions/opencode", () => opencodeMocks);

function createStorageMock() {
  let store: Record<string, string> = {};

  return {
    clear: () => {
      store = {};
    },
    getItem: (key: string) => store[key] ?? null,
    removeItem: (key: string) => {
      delete store[key];
    },
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

const rootSession: WorkspaceSession = {
  id: "root",
  title: "Root",
  status: "idle",
  updatedAt: "now",
};

const childSession: WorkspaceSession = {
  id: "child",
  title: "Child",
  status: "idle",
  updatedAt: "now",
  parentId: "root",
};

describe("useWorkspaceSessions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("sessionStorage", createStorageMock());
    vi.mocked(opencodeMocks.listSessionsAction).mockResolvedValue({
      ok: true,
      sessions: [rootSession],
      hasMore: false,
    });
    vi.mocked(opencodeMocks.listSessionFamilyAction).mockResolvedValue({
      ok: true,
      rootSessionId: "root",
      sessions: [rootSession, childSession],
    });
    vi.mocked(opencodeMocks.deleteSessionAction).mockResolvedValue({ ok: true });
    vi.mocked(opencodeMocks.createSessionAction).mockResolvedValue({
      ok: true,
      session: { ...rootSession, id: "created", title: "Created" },
    });
    vi.mocked(opencodeMocks.updateSessionAction).mockResolvedValue({ ok: true });
    vi.mocked(opencodeMocks.markFlowRunSeenAction).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns the deleted loaded family IDs", async () => {
    const { result } = renderHook(() =>
      useWorkspaceSessions({
        slug: "alice",
        initialSessionId: "child",
        isConnected: true,
      })
    );

    await act(async () => {
      await result.current.loadSessions();
    });

    await waitFor(() => {
      expect(result.current.sessions.map((session) => session.id)).toEqual([
        "root",
        "child",
      ]);
    });

    const deleteResult = await act(async () => result.current.deleteSession("root"));

    if (!deleteResult) throw new Error("Expected deleteSession to succeed");
    expect([...deleteResult.deletedSessionIds].sort()).toEqual([
      "child",
      "root",
    ]);
    expect(result.current.sessions).toEqual([]);
  });

  it("keeps the initial state pending until the requested session family resolves", async () => {
    let resolveFamily!: (value: {
      ok: boolean;
      rootSessionId: string;
      sessions: WorkspaceSession[];
    }) => void;
    const familyResult = new Promise<{
      ok: boolean;
      rootSessionId: string;
      sessions: WorkspaceSession[];
    }>((resolve) => {
      resolveFamily = resolve;
    });
    vi.mocked(opencodeMocks.listSessionFamilyAction).mockReturnValue(familyResult);

    const { result } = renderHook(() =>
      useWorkspaceSessions({
        slug: "alice",
        initialSessionId: "child",
        isConnected: true,
      })
    );
    let loadSessions!: Promise<void>;

    act(() => {
      loadSessions = result.current.loadSessions();
    });

    await waitFor(() => {
      expect(opencodeMocks.listSessionFamilyAction).toHaveBeenCalledWith("alice", "child");
    });
    expect(result.current.isInitialSessionsReady).toBe(false);
    expect(result.current.activeSessionId).toBeNull();

    await act(async () => {
      resolveFamily({
        ok: true,
        rootSessionId: "root",
        sessions: [rootSession, childSession],
      });
      await loadSessions;
    });

    expect(result.current.isInitialSessionsReady).toBe(true);
    expect(result.current.activeSessionId).toBe("child");
  });

  it("reports an initial session loading error without treating it as empty", async () => {
    vi.mocked(opencodeMocks.listSessionsAction).mockResolvedValue({
      ok: false,
      error: "instance_unavailable",
    });

    const { result } = renderHook(() =>
      useWorkspaceSessions({ slug: "alice", isConnected: true })
    );

    await act(async () => {
      await result.current.loadSessions();
    });

    expect(result.current.isInitialSessionsReady).toBe(false);
    expect(result.current.sessionsError).toBe("instance_unavailable");
    expect(result.current.sessions).toEqual([]);
  });

  it("marks an empty initial session list ready", async () => {
    vi.mocked(opencodeMocks.listSessionsAction).mockResolvedValue({
      ok: true,
      sessions: [],
      hasMore: false,
    });

    const { result } = renderHook(() =>
      useWorkspaceSessions({ slug: "alice", isConnected: true })
    );

    expect(result.current.isInitialSessionsReady).toBe(false);

    await act(async () => {
      await result.current.loadSessions();
    });

    expect(result.current.isInitialSessionsReady).toBe(true);
    expect(result.current.sessionsError).toBeNull();
    expect(result.current.sessions).toEqual([]);
  });

  it("does not overlap initial session loads and resolves when the active load finishes", async () => {
    const sessionsResult = createDeferred<{
      ok: true;
      sessions: WorkspaceSession[];
      hasMore: boolean;
    }>();
    vi.mocked(opencodeMocks.listSessionsAction).mockImplementation(
      () => sessionsResult.promise
    );

    const { result } = renderHook(() =>
      useWorkspaceSessions({ slug: "alice", isConnected: true })
    );
    let firstLoad!: Promise<void>;
    let pollingLoad!: Promise<void>;

    act(() => {
      firstLoad = result.current.loadSessions();
      pollingLoad = result.current.loadSessions();
    });

    expect(opencodeMocks.listSessionsAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      sessionsResult.resolve({
        ok: true,
        sessions: [rootSession],
        hasMore: false,
      });
      await Promise.all([firstLoad, pollingLoad]);
    });

    expect(result.current.isInitialSessionsReady).toBe(true);
  });

  it("resolves initial readiness after a session is created during the load", async () => {
    const sessionsResult = createDeferred<{
      ok: true;
      sessions: WorkspaceSession[];
      hasMore: boolean;
    }>();
    vi.mocked(opencodeMocks.listSessionsAction)
      .mockImplementationOnce(() => sessionsResult.promise)
      .mockResolvedValue({
        ok: true,
        sessions: [rootSession],
        hasMore: false,
      });

    const { result } = renderHook(() =>
      useWorkspaceSessions({ slug: "alice", isConnected: true })
    );
    let initialLoad!: Promise<void>;

    act(() => {
      initialLoad = result.current.loadSessions();
    });

    await waitFor(() => {
      expect(opencodeMocks.listSessionsAction).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.createSession("Created while loading");
    });

    await act(async () => {
      sessionsResult.resolve({
        ok: true,
        sessions: [rootSession],
        hasMore: false,
      });
      await initialLoad;
    });

    await waitFor(() => {
      expect(result.current.isInitialSessionsReady).toBe(true);
    });
  });

  it("resolves initial readiness after a session is deleted during the load", async () => {
    const { result } = renderHook(() =>
      useWorkspaceSessions({ slug: "alice", isConnected: true })
    );
    const createdSession = await act(async () => result.current.createSession("Created first"));
    if (!createdSession) throw new Error("Expected createSession to succeed");

    const sessionsResult = createDeferred<{
      ok: true;
      sessions: WorkspaceSession[];
      hasMore: boolean;
    }>();
    vi.mocked(opencodeMocks.listSessionsAction)
      .mockImplementationOnce(() => sessionsResult.promise)
      .mockResolvedValue({
        ok: true,
        sessions: [],
        hasMore: false,
      });
    let initialLoad!: Promise<void>;

    act(() => {
      initialLoad = result.current.loadSessions();
    });

    await waitFor(() => {
      expect(opencodeMocks.listSessionsAction).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.deleteSession(createdSession.id);
    });

    await act(async () => {
      sessionsResult.resolve({
        ok: true,
        sessions: [],
        hasMore: false,
      });
      await initialLoad;
    });

    await waitFor(() => {
      expect(result.current.isInitialSessionsReady).toBe(true);
    });
  });

  it("keeps the session error visible while an initial retry is pending", async () => {
    const retryResult = createDeferred<{
      ok: true;
      sessions: WorkspaceSession[];
      hasMore: boolean;
    }>();
    vi.mocked(opencodeMocks.listSessionsAction)
      .mockResolvedValueOnce({ ok: false, error: "instance_unavailable" })
      .mockImplementationOnce(() => retryResult.promise);

    const { result } = renderHook(() =>
      useWorkspaceSessions({ slug: "alice", isConnected: true })
    );

    await act(async () => {
      await result.current.loadSessions();
    });
    expect(result.current.sessionsError).toBe("instance_unavailable");

    let retryLoad!: Promise<void>;
    act(() => {
      retryLoad = result.current.loadSessions();
    });

    expect(result.current.sessionsError).toBe("instance_unavailable");

    await act(async () => {
      retryResult.resolve({ ok: true, sessions: [], hasMore: false });
      await retryLoad;
    });

    expect(result.current.isInitialSessionsReady).toBe(true);
    expect(result.current.sessionsError).toBeNull();
  });

  it("does not mutate the active-session ref imperatively before render", async () => {
    const { result } = renderHook(() =>
      useWorkspaceSessions({ slug: "alice", isConnected: true })
    );

    act(() => {
      result.current.selectSession("root");
    });

    expect(result.current.activeSessionId).toBe("root");
    expect(result.current.activeSessionIdRef.current).toBe("root");
  });

  it("keeps no session selected when nothing is explicitly requested", async () => {
    const { result } = renderHook(() =>
      useWorkspaceSessions({ slug: "alice", isConnected: true })
    );

    await act(async () => {
      await result.current.loadSessions();
    });

    expect(result.current.isInitialSessionsReady).toBe(true);
    expect(result.current.sessions.map((session) => session.id)).toEqual(["root"]);
    expect(result.current.activeSessionId).toBeNull();
  });

  it("returns to no selection when the active session is deleted", async () => {
    const { result } = renderHook(() =>
      useWorkspaceSessions({
        slug: "alice",
        initialSessionId: "root",
        isConnected: true,
      })
    );

    await act(async () => {
      await result.current.loadSessions();
    });

    expect(result.current.activeSessionId).toBe("root");

    await act(async () => {
      await result.current.deleteSession("root");
    });

    expect(result.current.activeSessionId).toBeNull();
  });
});

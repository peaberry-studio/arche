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

  it("keeps the initial state pending until the stored session family resolves", async () => {
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
      useWorkspaceSessions({ slug: "alice", isConnected: true })
    );
    sessionStorage.setItem("arche.workspace.alice.active-session", "child");
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

  it("prefers sessionStorage over localStorage for the stored active session", async () => {
    const { result } = renderHook(() =>
      useWorkspaceSessions({ slug: "alice", isConnected: true })
    );

    localStorage.setItem("arche.workspace.alice.active-session", "root");
    sessionStorage.setItem("arche.workspace.alice.active-session", "child");

    await act(async () => {
      await result.current.loadSessions();
    });

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("child");
    });
  });
});

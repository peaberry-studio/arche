/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceMessageActions } from "@/hooks/workspace/use-workspace-message-actions";
import { createEmptyChatStore, type ChatStore } from "@/lib/opencode/event-reducer";
import type { WorkspacePermission } from "@/lib/opencode/permission";

const opencodeMocks = vi.hoisted(() => ({
  abortSessionAction: vi.fn(),
  listPermissionsAction: vi.fn(),
}));

vi.mock("@/actions/opencode", () => ({
  abortSessionAction: opencodeMocks.abortSessionAction,
  listPermissionsAction: opencodeMocks.listPermissionsAction,
}));

function permission(id: string, sessionId: string): WorkspacePermission {
  return { id, sessionId, title: `Approve ${id}`, state: "pending" };
}

describe("useWorkspaceMessageActions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    opencodeMocks.listPermissionsAction.mockResolvedValue({ ok: true, permissions: {} });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function renderActions(store: ChatStore = createEmptyChatStore()) {
    let current = store;
    const getStore = () => current;
    const commitStore = (updater: ChatStore | ((prev: ChatStore) => ChatStore)) => {
      current = typeof updater === "function" ? updater(current) : updater;
    };

    const hook = renderHook(() =>
      useWorkspaceMessageActions({
        slug: "alice",
        activeSessionIdRef: { current: "s1" },
        agentDefaultModel: null,
        createSession: vi.fn(),
        models: [],
        primaryAgentId: null,
        sessionSelectionStateRef: { current: {} },
        getStore,
        commitStore,
        onStartingNewSessionChange: vi.fn(),
      }),
    );

    return { hook, getStore, commitStore };
  }

  it("does not insert a local user message; the bus is the source of truth", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 202 })));
    const { hook, getStore } = renderActions();

    let sent = false;
    await act(async () => {
      sent = await hook.result.current.sendMessage("Hola");
    });

    expect(sent).toBe(true);
    expect(getStore().messages.s1 ?? []).toHaveLength(0);
    expect(getStore().sessionStatus.s1).toBe("busy");
  });

  it("keeps sessionStatus busy when prompt returns 409", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 409 })));
    const { hook, getStore } = renderActions();

    let sent = true;
    await act(async () => {
      sent = await hook.result.current.sendMessage("Hola");
    });

    expect(sent).toBe(false);
    expect(getStore().messages.s1 ?? []).toHaveLength(0);
    expect(getStore().sessionStatus.s1).toBe("busy");
  });

  it("restores idle when prompt fails with a non-409 error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    const { hook, getStore } = renderActions();

    await act(async () => {
      await hook.result.current.sendMessage("Hola");
    });

    expect(getStore().sessionStatus.s1).toBe("idle");
    expect(getStore().messages.s1 ?? []).toHaveLength(0);
  });

  it("merges the permission safety-net snapshot per session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const { hook, getStore, commitStore } = renderActions();

    commitStore((current) => ({
      ...current,
      permissions: {
        s1: [permission("perm-1", "s1")],
        s2: [permission("perm-2", "s2")],
      },
    }));

    opencodeMocks.listPermissionsAction.mockResolvedValue({
      ok: true,
      permissions: { s1: [] },
    });

    await act(async () => {
      await hook.result.current.answerPermission("s1", "perm-1", "once");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(getStore().permissions.s1 ?? []).toHaveLength(0);
    expect(getStore().permissions.s2).toMatchObject([{ id: "perm-2", sessionId: "s2" }]);
  });

  it("skips the safety-net rewrite when listing permissions fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const { hook, getStore, commitStore } = renderActions();

    commitStore((current) => ({
      ...current,
      permissions: { s1: [permission("perm-1", "s1")] },
    }));
    opencodeMocks.listPermissionsAction.mockResolvedValue({ ok: false, error: "boom" });

    await act(async () => {
      await hook.result.current.answerPermission("s1", "perm-1", "once");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(getStore().permissions.s1).toMatchObject([{ id: "perm-1" }]);
  });
});

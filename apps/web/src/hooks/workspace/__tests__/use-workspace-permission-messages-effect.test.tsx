/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspacePermissionMessagesEffect } from "@/hooks/workspace/use-workspace-permission-messages-effect";
import type { WorkspacePermission } from "@/lib/opencode/permission";

function makePermission(sessionId: string): WorkspacePermission {
  return {
    id: `perm-${sessionId}`,
    sessionId,
    callId: `call-${sessionId}`,
    title: "arche_zendesk_z1_get_ticket",
    state: "pending",
  };
}

describe("useWorkspacePermissionMessagesEffect", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("hydrates referenced sessions whose messages are not cached", () => {
    const hydrateSessionMessages = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspacePermissionMessagesEffect({
        enabled: true,
        hydrateSessionMessages,
        messagesBySession: { active: [] },
        permissions: [makePermission("child-1")],
      })
    );

    expect(hydrateSessionMessages).toHaveBeenCalledWith("child-1", { trackLoading: false });
  });

  it("skips sessions that are already cached and hydrates each missing session once", () => {
    const hydrateSessionMessages = vi.fn().mockResolvedValue(undefined);
    const permissions = [makePermission("child-1"), makePermission("active")];

    const { rerender } = renderHook(
      ({ messages }: { messages: Record<string, never[]> }) =>
        useWorkspacePermissionMessagesEffect({
          enabled: true,
          hydrateSessionMessages,
          messagesBySession: messages,
          permissions,
        }),
      { initialProps: { messages: { active: [] } as Record<string, never[]> } }
    );

    expect(hydrateSessionMessages).toHaveBeenCalledTimes(1);
    expect(hydrateSessionMessages).toHaveBeenCalledWith("child-1", { trackLoading: false });

    act(() => {
      rerender({ messages: { active: [], "child-1": [] } });
    });

    expect(hydrateSessionMessages).toHaveBeenCalledTimes(1);
  });

  it("does nothing when disabled", () => {
    const hydrateSessionMessages = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspacePermissionMessagesEffect({
        enabled: false,
        hydrateSessionMessages,
        messagesBySession: {},
        permissions: [makePermission("child-1")],
      })
    );

    expect(hydrateSessionMessages).not.toHaveBeenCalled();
  });

  it("does not retry a session that failed to hydrate", () => {
    const hydrateSessionMessages = vi.fn().mockRejectedValue(new Error("offline"));

    const { rerender } = renderHook(
      ({ permissions }: { permissions: WorkspacePermission[] }) =>
        useWorkspacePermissionMessagesEffect({
          enabled: true,
          hydrateSessionMessages,
          messagesBySession: {},
          permissions,
        }),
      { initialProps: { permissions: [makePermission("child-1")] } }
    );

    const permissions = [makePermission("child-1"), makePermission("child-2")];
    act(() => {
      rerender({ permissions });
    });

    expect(hydrateSessionMessages).toHaveBeenCalledTimes(2);
    expect(hydrateSessionMessages).toHaveBeenNthCalledWith(1, "child-1", { trackLoading: false });
    expect(hydrateSessionMessages).toHaveBeenNthCalledWith(2, "child-2", { trackLoading: false });
  });
});

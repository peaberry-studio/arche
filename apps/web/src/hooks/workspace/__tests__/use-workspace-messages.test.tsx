/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listMessagesAction } from "@/actions/opencode";
import { useWorkspaceMessages } from "@/hooks/workspace/use-workspace-messages";
import type { WorkspaceMessage } from "@/lib/opencode/types";

const opencodeMocks = vi.hoisted(() => ({
  listMessagesAction: vi.fn(),
}));

vi.mock("@/actions/opencode", () => opencodeMocks);

const pendingMessage: WorkspaceMessage = {
  id: "assistant-1",
  sessionId: "s1",
  role: "assistant",
  content: "",
  timestamp: "now",
  parts: [],
  pending: true,
};

describe("useWorkspaceMessages", () => {
  beforeEach(() => {
    vi.mocked(listMessagesAction).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("hydrates messages and reports them through onHydrated", async () => {
    const onHydrated = vi.fn();
    vi.mocked(listMessagesAction).mockResolvedValue({
      ok: true,
      messages: [pendingMessage],
    });

    const { result } = renderHook(() =>
      useWorkspaceMessages({
        slug: "alice",
        getActiveSessionId: () => "s1",
        onHydrated,
      })
    );

    await act(async () => {
      await result.current.refreshMessages();
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([pendingMessage]);
    });
    expect(onHydrated).toHaveBeenCalledWith("s1", [pendingMessage]);
  });

  it("clears session messages and resume failures through removeSessions", async () => {
    const { result } = renderHook(() =>
      useWorkspaceMessages({
        slug: "alice",
        getActiveSessionId: () => "s1",
      })
    );

    act(() => {
      result.current.updateSessionMessages("s1", [pendingMessage]);
      result.current.resumeFailureStateRef.current.set("assistant-1", {
        attempts: 1,
        lastFailureAt: 1,
        suppressed: false,
      });
      result.current.resumeFailureStateRef.current.set("other-message", {
        attempts: 1,
        lastFailureAt: 1,
        suppressed: false,
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([pendingMessage]);
    });

    act(() => {
      result.current.removeSessions(new Set(["s1"]));
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.resumeFailureStateRef.current.has("assistant-1")).toBe(false);
    expect(result.current.resumeFailureStateRef.current.has("other-message")).toBe(true);
  });
});

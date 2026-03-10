/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceDiffs, type WorkspaceDiff } from "@/hooks/use-workspace-diffs";

const opencodeMocks = vi.hoisted(() => ({
  getWorkspaceDiffsAction: vi.fn(),
}));

vi.mock("@/actions/opencode", () => opencodeMocks);

const sampleDiff: WorkspaceDiff = {
  path: "src/index.ts",
  status: "modified",
  additions: 5,
  deletions: 2,
  diff: "@@ -1,3 +1,5 @@\n+new line",
  conflicted: false,
};

describe("useWorkspaceDiffs", () => {
  beforeEach(() => {
    opencodeMocks.getWorkspaceDiffsAction.mockResolvedValue({
      ok: true,
      diffs: [sampleDiff],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts with empty diffs and not loading", () => {
    const { result } = renderHook(() => useWorkspaceDiffs("alice", true, false));
    expect(result.current.diffs).toEqual([]);
    expect(result.current.isLoadingDiffs).toBe(false);
    expect(result.current.diffsError).toBeNull();
  });

  it("loads diffs on refreshDiffs when connected", async () => {
    const { result } = renderHook(() => useWorkspaceDiffs("alice", true, true));

    await act(async () => {
      await result.current.refreshDiffs();
    });

    expect(result.current.diffs).toEqual([sampleDiff]);
    expect(result.current.diffsError).toBeNull();
    expect(opencodeMocks.getWorkspaceDiffsAction).toHaveBeenCalledWith("alice");
  });

  it("skips refresh when not connected and force is not set", async () => {
    const { result } = renderHook(() => useWorkspaceDiffs("alice", true, false));

    await act(async () => {
      await result.current.refreshDiffs();
    });

    expect(opencodeMocks.getWorkspaceDiffsAction).not.toHaveBeenCalled();
    expect(result.current.diffs).toEqual([]);
  });

  it("allows forced refresh even when not connected", async () => {
    const { result } = renderHook(() => useWorkspaceDiffs("alice", true, false));

    await act(async () => {
      await result.current.refreshDiffs({ force: true });
    });

    expect(opencodeMocks.getWorkspaceDiffsAction).toHaveBeenCalled();
    expect(result.current.diffs).toEqual([sampleDiff]);
  });

  it("skips refresh when not enabled", async () => {
    const { result } = renderHook(() => useWorkspaceDiffs("alice", false, true));

    await act(async () => {
      await result.current.refreshDiffs();
    });

    expect(opencodeMocks.getWorkspaceDiffsAction).not.toHaveBeenCalled();
  });

  it("sets diffsError on failure", async () => {
    opencodeMocks.getWorkspaceDiffsAction.mockResolvedValue({
      ok: false,
      error: "git_not_found",
    });

    const { result } = renderHook(() => useWorkspaceDiffs("alice", true, true));

    await act(async () => {
      await result.current.refreshDiffs();
    });

    expect(result.current.diffsError).toBe("git_not_found");
    expect(result.current.diffs).toEqual([]);
  });

  it("clears error on successful refresh after failure", async () => {
    opencodeMocks.getWorkspaceDiffsAction.mockResolvedValue({
      ok: false,
      error: "transient",
    });

    const { result } = renderHook(() => useWorkspaceDiffs("alice", true, true));

    await act(async () => {
      await result.current.refreshDiffs();
    });
    expect(result.current.diffsError).toBe("transient");

    opencodeMocks.getWorkspaceDiffsAction.mockResolvedValue({
      ok: true,
      diffs: [sampleDiff],
    });

    await act(async () => {
      await result.current.refreshDiffs();
    });

    expect(result.current.diffsError).toBeNull();
    expect(result.current.diffs).toEqual([sampleDiff]);
  });

  it("prevents overlapping refreshes", async () => {
    let resolveFirst: (() => void) | null = null;
    let callCount = 0;

    opencodeMocks.getWorkspaceDiffsAction.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve({ ok: true, diffs: [] });
        });
      }
      return Promise.resolve({ ok: true, diffs: [sampleDiff] });
    });

    const { result } = renderHook(() => useWorkspaceDiffs("alice", true, true));

    let firstRefresh: Promise<void>;
    act(() => {
      firstRefresh = result.current.refreshDiffs();
    });

    await waitFor(() => {
      expect(result.current.isLoadingDiffs).toBe(true);
    });

    // Second refresh should be skipped because first is still loading
    await act(async () => {
      await result.current.refreshDiffs();
    });

    expect(callCount).toBe(1);

    await act(async () => {
      resolveFirst!();
      await firstRefresh!;
    });

    expect(result.current.isLoadingDiffs).toBe(false);
  });

  it("triggers refresh via triggerDiffsRefresh when connected", async () => {
    const { result } = renderHook(() => useWorkspaceDiffs("alice", true, true));

    await act(async () => {
      result.current.triggerDiffsRefresh();
    });

    await waitFor(() => {
      expect(opencodeMocks.getWorkspaceDiffsAction).toHaveBeenCalled();
    });

    expect(result.current.diffs).toEqual([sampleDiff]);
  });

  it("does not trigger refresh via trigger when not connected", async () => {
    const { result } = renderHook(() => useWorkspaceDiffs("alice", true, false));

    await act(async () => {
      result.current.triggerDiffsRefresh();
    });

    // Even after trigger, the effect guard should prevent the call
    expect(opencodeMocks.getWorkspaceDiffsAction).not.toHaveBeenCalled();
  });
});

/** @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInstanceHeartbeat } from "@/hooks/use-instance-heartbeat";

describe("useInstanceHeartbeat", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends an immediate heartbeat when enabled", () => {
    renderHook(() => useInstanceHeartbeat("alice", true));

    expect(fetchMock).toHaveBeenCalledWith("/api/instances/alice/activity", {
      method: "PATCH",
      cache: "no-store",
    });
  });

  it("does not send heartbeat when disabled", () => {
    renderHook(() => useInstanceHeartbeat("alice", false));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends periodic heartbeats at 20s intervals", () => {
    renderHook(() => useInstanceHeartbeat("alice", true));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops sending heartbeats after unmount", () => {
    const { unmount } = renderHook(() => useInstanceHeartbeat("alice", true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();

    vi.advanceTimersByTime(20_000);
    // No additional calls after unmount
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("restarts heartbeats when slug changes", () => {
    const { rerender } = renderHook(
      ({ slug }) => useInstanceHeartbeat(slug, true),
      { initialProps: { slug: "alice" } }
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/instances/alice/activity", expect.any(Object));

    rerender({ slug: "bob" });

    expect(fetchMock).toHaveBeenCalledWith("/api/instances/bob/activity", expect.any(Object));
  });

  it("swallows fetch errors silently", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    // Should not throw
    renderHook(() => useInstanceHeartbeat("alice", true));

    // Advance past the initial tick to let the promise settle
    await vi.advanceTimersByTimeAsync(0);

    // No error thrown, hook still functional
    vi.advanceTimersByTime(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

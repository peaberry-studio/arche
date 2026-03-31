/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConfigStatus } from "@/hooks/use-config-status";

describe("useConfigStatus", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps pending as true once changes are detected", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pending: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pending: false }) });

    const { result } = renderHook(() => useConfigStatus("alice", true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.pending).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/instances/alice/config-status", {
      cache: "no-store",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(result.current.pending).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/instances/alice/config-status", {
      cache: "no-store",
    });
  });

  it("clears pending when polling is disabled", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ pending: true }) });

    const { result, rerender } = renderHook(
      ({ enabled }) => useConfigStatus("alice", enabled),
      { initialProps: { enabled: true } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.pending).toBe(true);

    rerender({ enabled: false });
    expect(result.current.pending).toBe(false);
  });
});

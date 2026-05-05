/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConfigStatus } from "@/hooks/use-config-status";
import { WORKSPACE_CONFIG_STATUS_CHANGED_EVENT } from '@/lib/runtime/config-status-events'

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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pending: true, reason: 'config' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pending: false, reason: null }) });

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
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ pending: true, reason: 'config' }) });

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

  it("clears provider sync pending when a later poll succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pending: true, reason: 'provider_sync' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pending: false, reason: null }) });

    const { result } = renderHook(() => useConfigStatus("alice", true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.reason).toBe('provider_sync');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.reason).toBeNull();
  });

  it("refreshes immediately when config changes are announced", async () => {
    vi.useRealTimers();

    const originalAddEventListener = window.addEventListener.bind(window);
    let configStatusListener: EventListener | null = null;

    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === WORKSPACE_CONFIG_STATUS_CHANGED_EVENT) {
        configStatusListener = listener as EventListener;
      }

      originalAddEventListener(type, listener, options);
    });

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pending: false, reason: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pending: true, reason: 'config' }) });

    const { result } = renderHook(() => useConfigStatus("alice", true));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(result.current.pending).toBe(false);
    expect(configStatusListener).not.toBeNull();

    act(() => {
      configStatusListener?.(new Event(WORKSPACE_CONFIG_STATUS_CHANGED_EVENT));
    });

    await waitFor(() => {
      expect(result.current.pending).toBe(true);
      expect(result.current.reason).toBe('config');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces restart errors from failed responses", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "restart_unavailable" }),
    });

    const { result } = renderHook(() => useConfigStatus("alice", false));

    await act(async () => {
      await result.current.restart();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/instances/alice/restart", {
      method: "POST",
      cache: "no-store",
    });
    expect(result.current.restarting).toBe(false);
    expect(result.current.restartError).toBe("restart_unavailable");
  });

  it("surfaces network errors during restart", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(() => useConfigStatus("alice", false));

    await act(async () => {
      await result.current.restart();
    });

    expect(result.current.restarting).toBe(false);
    expect(result.current.restartError).toBe("network_error");
  });

  it("ignores polling failures", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));

    const { result } = renderHook(() => useConfigStatus("alice", true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.reason).toBeNull();
  });
});

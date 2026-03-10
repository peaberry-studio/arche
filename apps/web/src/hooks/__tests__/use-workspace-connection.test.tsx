/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceConnection } from "@/hooks/use-workspace-connection";

const opencodeMocks = vi.hoisted(() => ({
  checkConnectionAction: vi.fn(),
}));

vi.mock("@/actions/opencode", () => opencodeMocks);

describe("useWorkspaceConnection", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("starts in connecting state", () => {
    opencodeMocks.checkConnectionAction.mockResolvedValue({ status: "connected" });
    const onConnected = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceConnection("alice", true, onConnected)
    );

    expect(result.current.connection.status).toBe("connecting");
    expect(result.current.isConnected).toBe(false);
  });

  it("transitions to connected and calls onConnected on success", async () => {
    opencodeMocks.checkConnectionAction.mockResolvedValue({ status: "connected" });
    const onConnected = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useWorkspaceConnection("alice", true, onConnected)
    );

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });

    expect(result.current.connection.status).toBe("connected");
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("does not check connection when disabled", async () => {
    opencodeMocks.checkConnectionAction.mockResolvedValue({ status: "connected" });
    const onConnected = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceConnection("alice", false, onConnected)
    );

    // Give the effect a chance to run (it shouldn't)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(opencodeMocks.checkConnectionAction).not.toHaveBeenCalled();
    expect(result.current.connection.status).toBe("connecting");
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("retries with exponential backoff on connection failure", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    opencodeMocks.checkConnectionAction.mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return { status: "disconnected", error: "unavailable" };
      }
      return { status: "connected" };
    });

    const onConnected = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useWorkspaceConnection("alice", true, onConnected)
    );

    // First check fails immediately
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(callCount).toBe(1);

    // Retry after 1s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(callCount).toBe(2);

    // Retry after 2s (exponential backoff)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(callCount).toBe(3);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("resets to connecting state when disabled after being connected", async () => {
    opencodeMocks.checkConnectionAction.mockResolvedValue({ status: "connected" });
    const onConnected = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ enabled }) => useWorkspaceConnection("alice", enabled, onConnected),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });

    rerender({ enabled: false });

    expect(result.current.connection.status).toBe("connecting");
    expect(result.current.isConnected).toBe(false);
  });

  it("uses latest onConnected callback via ref", async () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn().mockResolvedValue(undefined);

    let resolveCheck: ((val: { status: string }) => void) | null = null;
    opencodeMocks.checkConnectionAction.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      })
    );

    const { rerender } = renderHook(
      ({ cb }) => useWorkspaceConnection("alice", true, cb),
      { initialProps: { cb: firstCallback } }
    );

    // Update the callback before connection resolves
    rerender({ cb: secondCallback });

    // Now resolve the connection
    await act(async () => {
      resolveCheck!({ status: "connected" });
    });

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledTimes(1);
  });

  it("cancels retry on unmount", async () => {
    vi.useFakeTimers();

    opencodeMocks.checkConnectionAction.mockResolvedValue({
      status: "disconnected",
      error: "unavailable",
    });

    const onConnected = vi.fn();
    const { unmount } = renderHook(() =>
      useWorkspaceConnection("alice", true, onConnected)
    );

    // First check fails
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callCountBeforeUnmount = opencodeMocks.checkConnectionAction.mock.calls.length;

    unmount();

    // Advance past retry delay
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(opencodeMocks.checkConnectionAction.mock.calls.length).toBe(callCountBeforeUnmount);
  });
});

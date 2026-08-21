/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspacePollingEffect } from "@/hooks/workspace/use-workspace-polling-effect";

function setVisibilityState(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

describe("useWorkspacePollingEffect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibilityState("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls at the configured interval while enabled", async () => {
    const loadSessions = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspacePollingEffect({
        enabled: true,
        isConnected: true,
        loadSessions,
        pollInterval: 20_000,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(loadSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(loadSessions).toHaveBeenCalledTimes(2);
  });

  it("pauses polling while the document is hidden", async () => {
    const loadSessions = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspacePollingEffect({
        enabled: true,
        isConnected: true,
        loadSessions,
        pollInterval: 20_000,
      })
    );

    setVisibilityState("hidden");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
    });
    expect(loadSessions).not.toHaveBeenCalled();
  });

  it("resumes polling and refreshes immediately when the document becomes visible", async () => {
    const loadSessions = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspacePollingEffect({
        enabled: true,
        isConnected: true,
        loadSessions,
        pollInterval: 20_000,
      })
    );

    setVisibilityState("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(loadSessions).not.toHaveBeenCalled();

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loadSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(loadSessions).toHaveBeenCalledTimes(2);
  });

  it("does not poll when disabled or disconnected", async () => {
    const loadSessions = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspacePollingEffect({
        enabled: false,
        isConnected: true,
        loadSessions,
        pollInterval: 20_000,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
    });
    expect(loadSessions).not.toHaveBeenCalled();

    renderHook(() =>
      useWorkspacePollingEffect({
        enabled: true,
        isConnected: false,
        loadSessions,
        pollInterval: 20_000,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
    });
    expect(loadSessions).not.toHaveBeenCalled();
  });

  it("clears the interval on unmount", async () => {
    const loadSessions = vi.fn().mockResolvedValue(undefined);

    const { unmount } = renderHook(() =>
      useWorkspacePollingEffect({
        enabled: true,
        isConnected: true,
        loadSessions,
        pollInterval: 20_000,
      })
    );

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
    });
    expect(loadSessions).not.toHaveBeenCalled();
  });
});

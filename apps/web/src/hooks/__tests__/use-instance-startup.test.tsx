/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INSTANCE_START_TIMEOUT_MS, useInstanceStartup } from "@/hooks/use-instance-startup";

const ensureInstanceRunningActionMock = vi.hoisted(() => vi.fn());
const routerReplaceMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    push: vi.fn(),
  }),
}));

vi.mock("@/actions/spawner", () => ({
  ensureInstanceRunningAction: (...args: unknown[]) => ensureInstanceRunningActionMock(...args),
}));

function renderStartupHook(initialSlug = "alice") {
  return renderHook((slug: string = initialSlug) => useInstanceStartup(slug), {
    initialProps: initialSlug,
  });
}

describe("useInstanceStartup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureInstanceRunningActionMock.mockResolvedValue({ status: "running" });
  });

  afterEach(() => {
    cleanup();
  });

  it("calls ensureInstanceRunningAction once per slug and resolves running", async () => {
    const { result, rerender } = renderStartupHook("alice");

    await waitFor(() => expect(result.current.instanceStatus).toBe("running"));
    expect(ensureInstanceRunningActionMock).toHaveBeenCalledTimes(1);
    expect(ensureInstanceRunningActionMock).toHaveBeenCalledWith("alice");

    // Re-renders (e.g. a child swap under the runtime provider) must not
    // restart the instance startup check.
    rerender("alice");
    rerender("alice");

    expect(ensureInstanceRunningActionMock).toHaveBeenCalledTimes(1);
    expect(result.current.instanceStatus).toBe("running");
    expect(result.current.instanceError).toBeNull();
  });

  it("re-runs the startup check when the slug changes", async () => {
    const { result, rerender } = renderStartupHook("alice");

    await waitFor(() => expect(result.current.instanceStatus).toBe("running"));

    rerender("bob");

    await waitFor(() =>
      expect(ensureInstanceRunningActionMock).toHaveBeenCalledWith("bob"),
    );
    expect(ensureInstanceRunningActionMock).toHaveBeenCalledTimes(2);
  });

  it("exposes a starting status while the instance is not running yet", async () => {
    ensureInstanceRunningActionMock.mockResolvedValue({ status: "starting" });

    const { result } = renderStartupHook("alice");

    await waitFor(() => expect(result.current.instanceStatus).toBe("starting"));
    expect(result.current.instanceError).toBeNull();
  });

  it("surfaces a formatted error when startup fails", async () => {
    ensureInstanceRunningActionMock.mockResolvedValue({
      status: "error",
      error: "start_timeout",
    });

    const { result } = renderStartupHook("alice");

    await waitFor(() => expect(result.current.instanceStatus).toBe("error"));
    expect(result.current.instanceError).toBe(
      "Workspace startup timed out. Try restarting again.",
    );
  });

  it("redirects to the setup gate when kickstart is not ready", async () => {
    ensureInstanceRunningActionMock.mockResolvedValue({
      status: "error",
      error: "setup_required",
    });

    const { result } = renderStartupHook("alice");

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/u/alice?setup=required"));
    // The setup redirect must not surface as an in-shell startup error.
    expect(result.current.instanceStatus).not.toBe("error");
    expect(result.current.instanceError).toBeNull();
  });

  it("arms the timeout before the server action resolves and ignores a late response", async () => {
    let resolveAction!: (value: unknown) => void;
    ensureInstanceRunningActionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );

    vi.useFakeTimers();

    try {
      const { result } = renderStartupHook("alice");

      // "starting" is surfaced synchronously once the attempt is armed.
      expect(result.current.instanceStatus).toBe("starting");

      // The independent client timeout fires even though the server action is
      // still pending.
      act(() => {
        vi.advanceTimersByTime(INSTANCE_START_TIMEOUT_MS);
      });
      expect(result.current.instanceStatus).toBe("error");
      expect(result.current.instanceError).toBe(
        "Workspace startup timed out. Try restarting again.",
      );

      // A late server response must not overwrite the timed-out state.
      await act(async () => {
        resolveAction({ status: "running" });
      });
      expect(result.current.instanceStatus).toBe("error");
      expect(result.current.instanceError).toBe(
        "Workspace startup timed out. Try restarting again.",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

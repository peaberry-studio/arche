/** @vitest-environment jsdom */

import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceConnectingBanner } from "@/components/workspace/workspace-startup-screens";
import { INSTANCE_START_TIMEOUT_MS, useInstanceStartup } from "@/hooks/use-instance-startup";

const ensureInstanceRunningActionMock = vi.hoisted(() => vi.fn());
const getInstanceMigrationStatusActionMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
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

function StartupBanner() {
  const startup = useInstanceStartup("alice");
  return <WorkspaceConnectingBanner {...startup} connection={{ status: "connecting" }} />;
}

describe("useInstanceStartup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    ensureInstanceRunningActionMock.mockResolvedValue({ status: "running" });
    getInstanceMigrationStatusActionMock.mockResolvedValue(false);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      migratingHistory: await getInstanceMigrationStatusActionMock(),
    })));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it("polls migration independently while the startup action is pending", async () => {
    vi.useFakeTimers();
    ensureInstanceRunningActionMock.mockReturnValue(new Promise(() => {}));
    getInstanceMigrationStatusActionMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { result } = renderStartupHook();

    await act(async () => {});
    expect(result.current.instanceStatus).toBe("starting");

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(result.current.instanceStatus).toBe("migrating_history");
    expect(result.current.instanceError).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/instances/alice/migration-status", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(ensureInstanceRunningActionMock).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(result.current.instanceStatus).toBe("starting");
  });

  it("keeps the migration state when the startup action reports starting", async () => {
    ensureInstanceRunningActionMock.mockResolvedValue({ status: "starting" });
    getInstanceMigrationStatusActionMock.mockResolvedValue(true);
    const { result } = renderStartupHook();

    await waitFor(() => expect(result.current.instanceStatus).toBe("migrating_history"));
  });

  it("renders migration progress before the startup action completes", async () => {
    let resolveStartup: (value: { status: string }) => void = () => {};
    ensureInstanceRunningActionMock.mockReturnValue(new Promise((resolve) => {
      resolveStartup = resolve;
    }));
    getInstanceMigrationStatusActionMock.mockResolvedValue(true);
    render(<StartupBanner />);

    await screen.findByRole("heading", { name: "Migrating history" });
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => { resolveStartup({ status: "running" }); });
    expect(screen.queryByText("Migrating history")).toBeNull();
    expect(screen.getByText("Connecting to OpenCode")).toBeTruthy();
  });

  it("keeps startup pending when the progress endpoint is unavailable", async () => {
    vi.useFakeTimers();
    ensureInstanceRunningActionMock.mockReturnValue(new Promise(() => {}));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    getInstanceMigrationStatusActionMock.mockResolvedValue(true);
    const { result } = renderStartupHook();

    await act(async () => {});
    expect(result.current.instanceStatus).toBe("starting");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(result.current.instanceStatus).toBe("migrating_history");
  });

  it.each([
    { response: { status: "running" }, expectedStatus: "running" },
    { response: { status: "error", error: "start_failed" }, expectedStatus: "error" },
    { response: { status: "error", error: "setup_required" }, expectedStatus: "starting" },
  ])("ignores late migration responses after startup settles ($expectedStatus)", async ({ response, expectedStatus }) => {
    vi.useFakeTimers();
    let resolveMigration: (value: boolean) => void = () => {};
    getInstanceMigrationStatusActionMock.mockReturnValue(new Promise<boolean>((resolve) => {
      resolveMigration = resolve;
    }));
    ensureInstanceRunningActionMock.mockResolvedValue(response);
    const terminal = renderStartupHook();
    await act(async () => {});
    expect(terminal.result.current.instanceStatus).toBe(expectedStatus);

    await act(async () => { resolveMigration(true); });
    expect(terminal.result.current.instanceStatus).toBe(expectedStatus);
    const calls = getInstanceMigrationStatusActionMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(getInstanceMigrationStatusActionMock).toHaveBeenCalledTimes(calls);
  });

  it("does not overlap progress requests and ignores late progress after timeout", async () => {
    vi.useFakeTimers();
    ensureInstanceRunningActionMock.mockReturnValue(new Promise(() => {}));
    let resolveMigration: (value: boolean) => void = () => {};
    getInstanceMigrationStatusActionMock.mockReturnValue(new Promise<boolean>((resolve) => {
      resolveMigration = resolve;
    }));
    const { result } = renderStartupHook();

    await act(async () => { await vi.advanceTimersByTimeAsync(INSTANCE_START_TIMEOUT_MS); });
    expect(getInstanceMigrationStatusActionMock).toHaveBeenCalledTimes(1);
    expect(result.current.instanceStatus).toBe("error");
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { resolveMigration(true); });
    expect(result.current.instanceStatus).toBe("error");
  });

  it("resets progress on slug changes and ignores the previous workspace response", async () => {
    vi.useFakeTimers();
    ensureInstanceRunningActionMock.mockReturnValue(new Promise(() => {}));
    let resolveMigration: (value: boolean) => void = () => {};
    getInstanceMigrationStatusActionMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      resolveMigration = resolve;
    }));
    const { result, rerender, unmount } = renderStartupHook();

    rerender("bob");
    await act(async () => { resolveMigration(true); });
    expect(result.current.instanceStatus).toBe("starting");
    expect(fetchMock).toHaveBeenCalledWith("/api/instances/bob/migration-status", expect.any(Object));
    unmount();
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    const calls = getInstanceMigrationStatusActionMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(getInstanceMigrationStatusActionMock).toHaveBeenCalledTimes(calls);
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

/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useWorkspaceRuntime,
  WorkspaceRuntimeProvider,
} from "@/contexts/workspace-runtime-context";
import type { WorkspaceConnectionState } from "@/lib/opencode/types";

const ensureInstanceRunningActionMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/spawner", () => ({
  ensureInstanceRunningAction: (...args: unknown[]) => ensureInstanceRunningActionMock(...args),
}));

const instanceStartupMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-instance-startup", () => ({
  useInstanceStartup: (...args: unknown[]) => instanceStartupMock(...args),
}));

const connectionMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-workspace-connection", () => ({
  useWorkspaceConnection: (...args: unknown[]) => connectionMock(...args),
}));

const heartbeatMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-instance-heartbeat", () => ({
  useInstanceHeartbeat: (...args: unknown[]) => heartbeatMock(...args),
}));

const sessionsMock = vi.hoisted(() => vi.fn(() => ({ activeSessionId: null })));
vi.mock("@/hooks/workspace/use-workspace-sessions", () => ({
  useWorkspaceSessions: (...args: unknown[]) => sessionsMock(...args),
}));

const searchParamsMock = vi.hoisted(() => vi.fn(() => null));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock(),
}));

function RuntimeView() {
  const value = useWorkspaceRuntime()
  return <div data-testid="runtime-view" data-slug={value.slug} data-status={value.instanceStatus} />
}

let instanceStatusValue: import("@/hooks/use-instance-startup").InstanceStartupStatus = "running"

function installStartupMock() {
  instanceStatusValue = "starting"
  instanceStartupMock.mockImplementation(() => {
    return { instanceStatus: instanceStatusValue, instanceError: null }
  })
}

describe("WorkspaceRuntimeProvider", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    ensureInstanceRunningActionMock.mockReset()
    instanceStartupMock.mockReset()
    connectionMock.mockReset()
    heartbeatMock.mockReset()

    instanceStartupMock.mockReturnValue({ instanceStatus: "running", instanceError: null })
    connectionMock.mockReturnValue({
      connection: { status: "connected" } as WorkspaceConnectionState,
      isConnected: true,
    })
    heartbeatMock.mockReturnValue(undefined)
    searchParamsMock.mockReturnValue(null)
  })

  it("exposes running status and wires the three runtime hooks to slug", () => {
    render(
      <WorkspaceRuntimeProvider slug="alice" persistenceScope="alice">
        <RuntimeView />
      </WorkspaceRuntimeProvider>
    )

    expect(instanceStartupMock).toHaveBeenCalledWith("alice")
    expect(connectionMock).toHaveBeenCalled()
    expect(heartbeatMock).toHaveBeenCalled()

    expect(screen.getByTestId("runtime-view").dataset.status).toBe("running")
  })

  it("keeps the resolved instance status across a child swap (provider stays mounted)", () => {
    installStartupMock()

    const { rerender } = render(
      <WorkspaceRuntimeProvider slug="alice" persistenceScope="alice">
        <div data-testid="child-a">A</div>
      </WorkspaceRuntimeProvider>
    )
    expect(instanceStartupMock).toHaveBeenCalledTimes(1)

    // Startup resolves to `running` on the first check.
    instanceStatusValue = "running"
    rerender(
      <WorkspaceRuntimeProvider slug="alice" persistenceScope="alice">
        <RuntimeView />
      </WorkspaceRuntimeProvider>
    )

    expect(screen.getByTestId("runtime-view").dataset.status).toBe("running")
    // The startup check must not be re-instantiated when a child is swapped.
    expect(instanceStartupMock).toHaveBeenCalledTimes(2)
  })

  it("seeds the initial session from the ?session= URL param when no prop is given", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=abc-123"))
    sessionsMock.mockClear()

    render(
      <WorkspaceRuntimeProvider slug="alice" persistenceScope="alice">
        <RuntimeView />
      </WorkspaceRuntimeProvider>
    )

    expect(sessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialSessionId: "abc-123" })
    )
  })

  it("prefers an explicit initialSessionId prop over the URL param", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("session=from-url"))
    sessionsMock.mockClear()

    render(
      <WorkspaceRuntimeProvider slug="alice" persistenceScope="alice" initialSessionId="from-prop">
        <RuntimeView />
      </WorkspaceRuntimeProvider>
    )

    expect(sessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialSessionId: "from-prop" })
    )
  })
})

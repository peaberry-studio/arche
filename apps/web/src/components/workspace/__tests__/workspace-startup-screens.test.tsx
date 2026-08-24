/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceConnectingBanner } from "@/components/workspace/workspace-startup-screens";
import type { WorkspaceConnectionState } from "@/lib/opencode/types";

function renderBanner({
  connection = { status: "connecting" } satisfies WorkspaceConnectionState,
  instanceStatus = null,
  instanceError = null,
}: {
  connection?: WorkspaceConnectionState;
  instanceStatus?: "starting" | "running" | "error" | null;
  instanceError?: string | null;
} = {}) {
  return render(
    <WorkspaceConnectingBanner
      connection={connection}
      instanceStatus={instanceStatus}
      instanceError={instanceError}
    />,
  );
}

describe("WorkspaceConnectingBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the starting state without an alert while the instance is starting", () => {
    renderBanner({ instanceStatus: "starting" });

    expect(screen.getByText("Starting workspace")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("treats a null instance status as starting", () => {
    renderBanner({ instanceStatus: null });

    expect(screen.getByText("Starting workspace")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces the startup failure as an alert with the instance error", () => {
    renderBanner({
      instanceStatus: "error",
      instanceError: "Workspace startup timed out. Try restarting again.",
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Failed to start");
    expect(alert.textContent).toContain("Workspace startup timed out. Try restarting again.");
  });

  it("falls back to a generic message when the startup error is missing", () => {
    renderBanner({ instanceStatus: "error", instanceError: null });

    expect(screen.getByRole("alert").textContent).toContain("Unable to start the workspace");
  });

  it("surfaces a connection failure after startup as an alert with mapped copy", () => {
    renderBanner({
      connection: { status: "error", error: "unhealthy" },
      instanceStatus: "running",
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Connecting to OpenCode");
    expect(alert.textContent).toContain("The workspace is not ready right now. Retrying...");
  });

  it("shows the connecting state without an alert while the connection is pending", () => {
    renderBanner({
      connection: { status: "connecting" },
      instanceStatus: "running",
    });

    expect(screen.getByText("Connecting to OpenCode")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

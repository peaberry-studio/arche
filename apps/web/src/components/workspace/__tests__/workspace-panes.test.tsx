/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspacePanes } from "@/components/workspace/workspace-panes";

const LEFT_MARKER = <div>Left Element</div>;
const CENTER_MARKER = <div>Center Element</div>;
const RIGHT_MARKER = <div>Right Element</div>;

function renderPanes(overrides: Record<string, unknown> = {}) {
  const props = {
    leftCollapsed: false,
    leftWidth: 220,
    rightCollapsed: false,
    rightWidth: 340,
    minCenterWidth: 360,
    isDragging: false,
    hasRightPanel: true,
    macDesktopWindowInset: false,
    containerRef: { current: null },
    leftElement: LEFT_MARKER,
    centerElement: CENTER_MARKER,
    rightElement: RIGHT_MARKER,
    onResizeLeft: vi.fn(),
    onResizeRight: vi.fn(),
    ...overrides,
  } as Parameters<typeof WorkspacePanes>[0];
  return render(<WorkspacePanes {...props} />);
}

function leftPane() {
  return screen.getByTestId("panes-left");
}

function rightPane() {
  return screen.getByTestId("panes-right");
}

describe("WorkspacePanes", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows left, center, and right panes when a right panel is provided", () => {
    renderPanes();

    expect(screen.getByText("Left Element")).toBeTruthy();
    expect(screen.getByText("Center Element")).toBeTruthy();
    expect(screen.getByText("Right Element")).toBeTruthy();
  });

  it("hides the right panel when there is nothing to render", () => {
    renderPanes({ hasRightPanel: false });

    expect(screen.getByText("Left Element")).toBeTruthy();
    expect(screen.getByText("Center Element")).toBeTruthy();
    expect(screen.queryByText("Right Element")).toBeNull();
  });

  it("collapses the left panel to the collapsed width while keeping its content", () => {
    renderPanes({ leftCollapsed: true });

    expect(leftPane().style.width).toBe("48px");
    expect(screen.getByText("Left Element")).toBeTruthy();
  });

  it("collapses the right panel to the collapsed width", () => {
    renderPanes({ rightCollapsed: true });

    expect(rightPane().style.width).toBe("48px");
    expect(screen.getByText("Right Element")).toBeTruthy();
  });

  it("renders resize separators for expanded panels and wires pointer events", () => {
    const onResizeLeft = vi.fn();
    const onResizeRight = vi.fn();
    renderPanes({ onResizeLeft, onResizeRight });

    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize left panel" }), { button: 0 });
    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize right panel" }), { button: 0 });

    expect(onResizeLeft).toHaveBeenCalledTimes(1);
    expect(onResizeRight).toHaveBeenCalledTimes(1);
  });

  it("hides the left resize separator while collapsed", () => {
    renderPanes({ leftCollapsed: true });

    expect(screen.queryByRole("separator", { name: "Resize left panel" })).toBeNull();
  });

  it("renders the desktop titlebar drag region when requested", () => {
    renderPanes({ macDesktopWindowInset: true });

    const dragRegion = screen.getByLabelText("Desktop titlebar drag region");
    expect(dragRegion.className).toContain("desktop-titlebar-drag");
  });
});

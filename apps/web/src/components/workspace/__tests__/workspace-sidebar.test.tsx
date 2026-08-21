/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import type { WorkspaceSession } from "@/lib/opencode/types";

const sessionFixtures: WorkspaceSession[] = [
  {
    id: "chat-1",
    title: "Chat one",
    status: "idle",
    updatedAt: "now",
    updatedAtRaw: 1,
  },
  {
    id: "flow-1",
    title: "Flow | Daily brief",
    status: "idle",
    updatedAt: "now",
    updatedAtRaw: 2,
    flow: {
      runId: "run-1",
      flowId: "flow-1",
      flowName: "Daily brief",
      status: "succeeded",
      trigger: "manual",
      hasUnseenResult: false,
    },
  },
];

function renderSidebar(overrides: Record<string, unknown> = {}) {
  const props = {
    sessions: sessionFixtures,
    activeSessionId: null,
    hasMoreSessions: false,
    isInitialSessionsReady: true,
    isLoadingMoreSessions: false,
    sessionsError: null,
    unseenCompletedSessions: new Set<string>(),
    knowledgePendingCount: 0,
    isCollapsed: false,
    activeMode: "chat" as const,
    accountMenu: (collapsed: boolean) => (
      <button
        type="button"
        aria-label="Workspace account menu"
        onClick={vi.fn()}
      >
        {collapsed ? "User" : "Account"}
      </button>
    ),
    onCreateSession: vi.fn(),
    onSelectSession: vi.fn(),
    onLoadMoreSessions: vi.fn(async () => {}),
    onMarkFlowRunSeen: vi.fn(),
    onToggleCollapsed: vi.fn(),
    onNavExplore: vi.fn(),
    onNavKnowledge: vi.fn(),
    onNavFlows: vi.fn(),
    ...overrides,
  } as Parameters<typeof WorkspaceSidebar>[0];
  return render(<WorkspaceSidebar {...props} />);
}

describe("WorkspaceSidebar", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the brand/header with Arche", () => {
    renderSidebar();
    expect(screen.getByText("Arche")).toBeTruthy();
  });

  it("shows the new-chat button that triggers chat creation", () => {
    const onCreateSession = vi.fn();
    renderSidebar({ onCreateSession });

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("renders nav items Explore, Knowledge, and Flows", () => {
    renderSidebar();

    expect(screen.getByRole("button", { name: "Explore" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Knowledge" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Flows" })).toBeTruthy();
  });

  it("shows the knowledge pending badge with the count prop", () => {
    renderSidebar({ knowledgePendingCount: 7 });

    expect(screen.getByLabelText("7 pending")).toBeTruthy();
  });

  it("does not show the knowledge badge when the count is zero", () => {
    renderSidebar({ knowledgePendingCount: 0 });

    expect(screen.queryByLabelText("0 pending")).toBeNull();
  });

  it("routes nav clicks to the provided callbacks", () => {
    const onNavExplore = vi.fn();
    const onNavKnowledge = vi.fn();
    const onNavFlows = vi.fn();
    renderSidebar({ onNavExplore, onNavKnowledge, onNavFlows });

    fireEvent.click(screen.getByRole("button", { name: "Explore" }));
    fireEvent.click(screen.getByRole("button", { name: "Knowledge" }));
    fireEvent.click(screen.getByRole("button", { name: "Flows" }));

    expect(onNavExplore).toHaveBeenCalledTimes(1);
    expect(onNavKnowledge).toHaveBeenCalledTimes(1);
    expect(onNavFlows).toHaveBeenCalledTimes(1);
  });

  it("renders the unified sessions list with chats and flow badges", () => {
    renderSidebar();

    expect(screen.getByRole("button", { name: /chat one/i })).toBeTruthy();
    const flowRow = screen.getByRole("button", { name: /daily brief/i });
    expect(flowRow.textContent).toContain("Flow");
  });

  it("selects a session from the list", () => {
    const onSelectSession = vi.fn();
    renderSidebar({ onSelectSession });

    fireEvent.click(screen.getByRole("button", { name: /chat one/i }));
    expect(onSelectSession).toHaveBeenCalledWith("chat-1");
  });

  it("shows the account menu in the footer", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "Workspace account menu" })).toBeTruthy();
  });

  it("collapses to logo, nav icons, sessions rail, and user slot", () => {
    renderSidebar({ isCollapsed: true });

    expect(screen.getByText("Arche")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Explore" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Knowledge" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Flows" })).toBeTruthy();
    expect(screen.getByLabelText("Sessions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Workspace account menu" })).toBeTruthy();
  });

  it("collapses to an icon-only user slot", () => {
    renderSidebar({ isCollapsed: true });
    const userButton = screen.getByRole("button", { name: "Workspace account menu" });
    expect(userButton.textContent).toContain("User");
  });

  it("toggles the collapsed state on command", () => {
    const onToggleCollapsed = vi.fn();
    const { rerender } = renderSidebar({ isCollapsed: false, onToggleCollapsed });

    fireEvent.click(screen.getByRole("button", { name: "Collapse sessions panel" }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    rerender(
      <WorkspaceSidebar
        {...({
          sessions: sessionFixtures,
          activeSessionId: null,
          hasMoreSessions: false,
          isInitialSessionsReady: true,
          isLoadingMoreSessions: false,
          sessionsError: null,
          unseenCompletedSessions: new Set<string>(),
          knowledgePendingCount: 0,
          isCollapsed: true,
          activeMode: "chat" as const,
          accountMenu: (collapsed: boolean) => (
            <button type="button" aria-label="Workspace account menu">
              {collapsed ? "User" : "Account"}
            </button>
          ),
          onCreateSession: vi.fn(),
          onSelectSession: vi.fn(),
          onLoadMoreSessions: vi.fn(async () => {}),
          onToggleCollapsed,
          onNavExplore: vi.fn(),
          onNavKnowledge: vi.fn(),
          onNavFlows: vi.fn(),
        } as Parameters<typeof WorkspaceSidebar>[0])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand sessions panel" }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(2);
  });

  it("includes macOS traffic lights in the header with a drag region", () => {
    renderSidebar({ macDesktopWindowInset: true });

    const trafficLights = screen.getByLabelText("macOS traffic lights");
    expect(trafficLights.className).toContain("desktop-titlebar-drag");
    expect(trafficLights.className).toContain("pl-[88px]");
  });
});

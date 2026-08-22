/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import type { WorkspaceSession } from "@/lib/opencode/types";

const navigation = vi.hoisted(() => ({
  pathname: null as string | null,
  searchParams: null as URLSearchParams | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.searchParams,
}));

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
    curatorOpen: false,
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
    onNavAgents: vi.fn(),
    onNavExplore: vi.fn(),
    onNavCurator: vi.fn(),
    onNavFlows: vi.fn(),
    onNavSkills: vi.fn(),
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
    navigation.pathname = null;
    navigation.searchParams = null;
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

  it("renders nav items Knowledge Base, Curator, Agents, Skills, and Flows", () => {
    renderSidebar();

    expect(screen.getByRole("button", { name: "Knowledge Base" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Curator" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skills" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Flows" })).toBeTruthy();
  });

  it("shows the curator pending badge with the count prop", () => {
    renderSidebar({ knowledgePendingCount: 7 });

    expect(screen.getByLabelText("7 pending")).toBeTruthy();
  });

  it("does not show the curator badge when the count is zero", () => {
    renderSidebar({ knowledgePendingCount: 0 });

    expect(screen.queryByLabelText("0 pending")).toBeNull();
  });

  it("routes nav clicks to the provided callbacks", () => {
    const onNavExplore = vi.fn();
    const onNavCurator = vi.fn();
    const onNavAgents = vi.fn();
    const onNavSkills = vi.fn();
    const onNavFlows = vi.fn();
    renderSidebar({ onNavExplore, onNavCurator, onNavAgents, onNavSkills, onNavFlows });

    fireEvent.click(screen.getByRole("button", { name: "Knowledge Base" }));
    fireEvent.click(screen.getByRole("button", { name: "Curator" }));
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Flows" }));

    expect(onNavExplore).toHaveBeenCalledTimes(1);
    expect(onNavCurator).toHaveBeenCalledTimes(1);
    expect(onNavAgents).toHaveBeenCalledTimes(1);
    expect(onNavSkills).toHaveBeenCalledTimes(1);
    expect(onNavFlows).toHaveBeenCalledTimes(1);
  });

  it("marks Knowledge Base as the active nav on the explore route", () => {
    navigation.pathname = "/w/alice/explore";
    renderSidebar();

    const knowledgeBase = screen.getByRole("button", { name: "Knowledge Base" });
    expect(knowledgeBase.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Agents" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Skills" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Flows" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("marks Agents and Skills active from the catalog query param", () => {
    navigation.searchParams = new URLSearchParams("catalog=agents");
    renderSidebar();

    expect(screen.getByRole("button", { name: "Agents" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Skills" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Knowledge Base" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("marks Flows active from the flows query param", () => {
    navigation.searchParams = new URLSearchParams("flows=list");
    renderSidebar();

    expect(screen.getByRole("button", { name: "Flows" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Agents" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("prefers flows over catalog and explore for the active nav", () => {
    navigation.pathname = "/w/alice/explore";
    navigation.searchParams = new URLSearchParams("flows=list&catalog=agents");
    renderSidebar();

    expect(screen.getByRole("button", { name: "Flows" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Agents" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Knowledge Base" }).getAttribute("aria-pressed")).toBe("false");
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

    expect(screen.getByRole("img", { name: "Arche" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Knowledge Base" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Curator" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skills" })).toBeTruthy();
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
          curatorOpen: false,
          accountMenu: (collapsed: boolean) => (
            <button type="button" aria-label="Workspace account menu">
              {collapsed ? "User" : "Account"}
            </button>
          ),
          onCreateSession: vi.fn(),
          onSelectSession: vi.fn(),
          onLoadMoreSessions: vi.fn(async () => {}),
          onToggleCollapsed,
          onNavAgents: vi.fn(),
          onNavCurator: vi.fn(),
          onNavExplore: vi.fn(),
          onNavSkills: vi.fn(),
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

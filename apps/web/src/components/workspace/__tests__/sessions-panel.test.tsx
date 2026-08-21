/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionsPanel } from "@/components/workspace/sessions-panel";
import type { WorkspaceSession } from "@/lib/opencode/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const chatSessions: WorkspaceSession[] = [
  {
    id: "idle-session",
    title: "Idle chat",
    status: "idle",
    updatedAt: "2m",
    updatedAtRaw: 1,
  },
  {
    id: "busy-session",
    title: "Busy chat",
    status: "busy",
    updatedAt: "1m",
    updatedAtRaw: 2,
  },
  {
    id: "done-session",
    title: "Done chat",
    status: "idle",
    updatedAt: "just now",
    updatedAtRaw: 3,
  },
];

const flowSession: WorkspaceSession = {
  id: "flow-session",
  title: "Flow | Daily summary",
  status: "idle",
  updatedAt: "now",
  updatedAtRaw: 4,
  flow: {
    runId: "run-1",
    flowId: "flow-1",
    flowName: "Daily summary",
    status: "succeeded",
    trigger: "schedule",
    hasUnseenResult: false,
  },
};

function renderPanel(sessions: WorkspaceSession[], overrides: Record<string, unknown> = {}) {
  const props = {
    sessions,
    activeSessionId: null,
    unseenCompletedSessions: new Set<string>(),
    onSelectSession: vi.fn(),
    onCreateSession: vi.fn(),
    ...overrides,
  } as Parameters<typeof SessionsPanel>[0];
  return render(<SessionsPanel {...props} />);
}

describe("SessionsPanel", () => {
  it("renders both chat sessions and flow sessions in the same list", () => {
    renderPanel([...chatSessions, flowSession]);

    expect(screen.getByRole("button", { name: /idle chat/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /busy chat/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Daily summary/i })).toBeTruthy();
  });

  it("shows a flow badge on flow sessions", () => {
    renderPanel([flowSession]);

    const flowRow = screen.getByRole("button", { name: /Daily summary/i });
    expect(flowRow.textContent).toContain("Flow");
    expect(flowRow.textContent).toContain("Flow | Daily summary");
  });

  it("filters out subagent sessions whose parent is in the list", () => {
    renderPanel([
      ...chatSessions,
      {
        id: "child-session",
        title: "Child session",
        status: "idle",
        updatedAt: "now",
        updatedAtRaw: 5,
        parentId: "idle-session",
      },
    ]);

    expect(screen.queryByRole("button", { name: /child session/i })).toBeNull();
    expect(screen.getByRole("button", { name: /idle chat/i })).toBeTruthy();
  });

  it("shows a waiting badge for flow sessions waiting for human input", () => {
    renderPanel([
      {
        ...flowSession,
        flow: { ...flowSession.flow!, status: "waiting_for_human" },
      },
    ]);

    expect(screen.getByText("Waiting")).toBeTruthy();
  });

  it("groups sessions by date buckets", () => {
    const now = Date.now();
    const dayMs = 86_400_000;
    renderPanel([
      { id: "today-session", title: "Today chat", status: "idle", updatedAt: "now", updatedAtRaw: now },
      { id: "yesterday-session", title: "Yesterday chat", status: "idle", updatedAt: "1d", updatedAtRaw: now - dayMs },
      { id: "old-session", title: "Old chat", status: "idle", updatedAt: "30d", updatedAtRaw: now - 30 * dayMs },
    ]);

    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Yesterday")).toBeTruthy();
    expect(screen.getByText("Older")).toBeTruthy();
  });

  it("shows unread indicators for unseen flow results and unseen completed chats", () => {
    render(
      <SessionsPanel
        sessions={[
          { ...flowSession, flow: { ...flowSession.flow!, hasUnseenResult: true } },
          chatSessions[2],
        ]}
        activeSessionId={null}
        unseenCompletedSessions={new Set(["done-session"]) as ReadonlySet<string>}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
      />
    );

    const flowRow = screen.getByRole("button", { name: /Daily summary/i });
    const doneRow = screen.getByRole("button", { name: /done chat/i });

    expect(flowRow.querySelector("svg.text-green-400")).toBeTruthy();
    expect(doneRow.querySelector("svg.text-green-400")).toBeTruthy();
  });

  it("hides idle indicators while preserving busy and completed indicators", () => {
    render(
      <SessionsPanel
        sessions={chatSessions}
        activeSessionId={"idle-session"}
        unseenCompletedSessions={new Set(["done-session"]) as ReadonlySet<string>}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
      />
    );

    const idleRow = screen.getByRole("button", { name: /idle chat/i });
    const busyRow = screen.getByRole("button", { name: /busy chat/i });
    const doneRow = screen.getByRole("button", { name: /done chat/i });

    const idleIndicatorWrapper = idleRow.querySelector('span[aria-hidden="true"]');
    const busyIndicatorWrapper = busyRow.querySelector('span[aria-hidden="true"]');

    expect(idleIndicatorWrapper?.className).toContain("w-0");
    expect(idleIndicatorWrapper?.className).toContain("opacity-0");
    expect(busyIndicatorWrapper?.className).toContain("w-2");
    expect(busyIndicatorWrapper?.className).toContain("opacity-100");
    expect(busyRow.querySelector("svg.text-amber-400")).toBeTruthy();
    expect(doneRow.querySelector("svg.text-green-400")).toBeTruthy();
  });

  it("renders timestamps hidden by default with hover fade classes", () => {
    renderPanel(chatSessions, { activeSessionId: "idle-session" });

    const timestamp = screen.getByText("2m");

    expect(timestamp.className).toContain("opacity-0");
    expect(timestamp.className).toContain("group-hover/session:opacity-100");
    expect(timestamp.className).toContain("transition-all");
  });

  it("shows flow sessions with flow context and matches them in search", () => {
    renderPanel([flowSession], { activeSessionId: "flow-session", query: "daily summary" });

    expect(screen.getByText("Daily summary")).toBeTruthy();
    expect(screen.getByText("Flow | Daily summary")).toBeTruthy();
  });

  it("offers chat creation in the empty chat state", () => {
    const onCreateSession = vi.fn();

    renderPanel([], { onCreateSession });

    expect(screen.getByText("No chats yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("shows an initial loading state instead of the empty chat state", () => {
    renderPanel([], { isInitialSessionsReady: false });

    expect(screen.getByText("Loading chats...")).toBeTruthy();
    expect(screen.queryByText("No chats yet")).toBeNull();
  });

  it("shows an initial loading error instead of the empty chat state", () => {
    renderPanel([], { isInitialSessionsReady: false, sessionsError: "instance_unavailable" });

    expect(screen.getByText("Couldn't load chats.")).toBeTruthy();
    expect(screen.queryByText("No chats yet")).toBeNull();
  });

  it("keeps rendering already loaded sessions while initial readiness is pending", () => {
    renderPanel(chatSessions, {
      activeSessionId: "idle-session",
      isInitialSessionsReady: false,
      sessionsError: "instance_unavailable",
    });

    expect(screen.getByRole("button", { name: /idle chat/i })).toBeTruthy();
    expect(screen.queryByText("Loading chats...")).toBeNull();
    expect(screen.queryByText("Couldn't load chats.")).toBeNull();
  });

  it("shows the chat search empty state with a creation shortcut", () => {
    const onCreateSession = vi.fn();

    renderPanel(chatSessions, { activeSessionId: "idle-session", query: "missing", onCreateSession });

    expect(screen.getByText("No chats found")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("requests more sessions when the load-more sentinel becomes visible", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let callback: IntersectionObserverCallback | null = null;

    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function IntersectionObserver(nextCallback: IntersectionObserverCallback) {
        callback = nextCallback;
        return {
          observe,
          disconnect,
          unobserve: vi.fn(),
          takeRecords: vi.fn(() => []),
          root: null,
          rootMargin: "",
          thresholds: [],
        } satisfies IntersectionObserver;
      })
    );

    const onLoadMore = vi.fn();

    renderPanel(chatSessions, { activeSessionId: "idle-session", hasMore: true, onLoadMore });

    expect(observe).toHaveBeenCalled();

    act(() => {
      callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });
});

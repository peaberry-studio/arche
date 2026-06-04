/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionsPanel } from "@/components/workspace/sessions-panel";
import type { WorkspaceSession } from "@/lib/opencode/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sessions: WorkspaceSession[] = [
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

describe("SessionsPanel", () => {
  it("hides idle indicators while preserving busy and completed indicators", () => {
    render(
      <SessionsPanel
        sessions={sessions}
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
    render(
      <SessionsPanel
        sessions={sessions}
        activeSessionId={"idle-session"}
        unseenCompletedSessions={new Set<string>()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
      />
    );

    const timestamp = screen.getByText("2m");

    expect(timestamp.className).toContain("opacity-0");
    expect(timestamp.className).toContain("group-hover/session:opacity-100");
    expect(timestamp.className).toContain("transition-all");
  });

  it("shows flow sessions with flow context and matches them in search", () => {
    render(
      <SessionsPanel
        sessions={[
          {
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
          },
        ]}
        activeSessionId={"flow-session"}
        unseenCompletedSessions={new Set<string>()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        kind="flows"
        query="daily summary"
      />
    );

    expect(screen.getByText("Daily summary")).toBeTruthy();
    expect(screen.getByText("Flow | Daily summary")).toBeTruthy();
  });

  it("hides chat creation affordances in flows mode", () => {
    render(
      <SessionsPanel
        sessions={[]}
        activeSessionId={null}
        unseenCompletedSessions={new Set<string>()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        kind="flows"
      />
    );

    expect(screen.getByText("No flows yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
  });

  it("offers chat creation in the empty chat state", () => {
    const onCreateSession = vi.fn();

    render(
      <SessionsPanel
        sessions={[]}
        activeSessionId={null}
        unseenCompletedSessions={new Set<string>()}
        onSelectSession={vi.fn()}
        onCreateSession={onCreateSession}
      />
    );

    expect(screen.getByText("No chats yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("shows the chat search empty state with a creation shortcut", () => {
    const onCreateSession = vi.fn();

    render(
      <SessionsPanel
        sessions={sessions}
        activeSessionId="idle-session"
        query="missing"
        unseenCompletedSessions={new Set<string>()}
        onSelectSession={vi.fn()}
        onCreateSession={onCreateSession}
      />
    );

    expect(screen.getByText("No chats found")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("shows flow-specific loading copy while fetching more", () => {
    render(
      <SessionsPanel
        sessions={sessions}
        activeSessionId="idle-session"
        isLoadingMore
        kind="flows"
        unseenCompletedSessions={new Set<string>()}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
      />
    );

    expect(screen.getByText("Loading more flows...")).toBeTruthy();
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

    render(
      <SessionsPanel
        sessions={sessions}
        activeSessionId={"idle-session"}
        hasMore
        unseenCompletedSessions={new Set<string>()}
        onLoadMore={onLoadMore}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
      />
    );

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

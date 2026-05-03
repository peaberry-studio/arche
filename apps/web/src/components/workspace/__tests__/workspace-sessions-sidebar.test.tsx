/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSessionsSidebar } from "@/components/workspace/workspace-sessions-sidebar";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const task = {
  id: "daily-review",
  name: "Daily review",
  prompt: "Review yesterday's changes",
  targetAgentId: null,
  cronExpression: "0 9 * * *",
  timezone: "UTC",
  enabled: true,
  nextRunAt: "2026-05-02T09:00:00.000Z",
  lastRunAt: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-01T09:00:00.000Z",
  latestRun: null,
};

describe("WorkspaceSessionsSidebar", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url === "/api/u/alice/autopilot") {
        return jsonResponse({ tasks: [task] });
      }

      if (url === "/api/u/alice/autopilot/daily-review/run" && init?.method === "POST") {
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: "not_found" }, 404);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("runs an autopilot task from the inbox Run menu", async () => {
    const onRunTaskComplete = vi.fn();

    render(
      <WorkspaceSessionsSidebar
        slug="alice"
        kind="tasks"
        sessions={[]}
        activeSessionId={null}
        hasMoreSessions={false}
        isLoadingMoreSessions={false}
        unseenCompletedSessions={new Set<string>()}
        onCreateSession={vi.fn()}
        onLoadMoreSessions={async () => {}}
        onRunTaskComplete={onRunTaskComplete}
        onSelectSession={vi.fn()}
      />
    );

    fireEvent.pointerDown(await screen.findByRole("button", { name: "Run task" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByText("Daily review"));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/u/alice/autopilot/daily-review/run", {
        method: "POST",
      });
    });
    expect(onRunTaskComplete).toHaveBeenCalledTimes(1);
  });
});

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

const flow = {
  id: "daily-review",
  name: "Daily review",
  description: "Review yesterday's changes",
  definition: { version: 1, startNodeId: "node-1", nodes: [], edges: [] },
  cronExpression: null,
  timezone: "UTC",
  enabled: true,
  nextRunAt: null,
  lastRunAt: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-01T09:00:00.000Z",
  latestRun: null,
};

describe("WorkspaceSessionsSidebar", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url === "/api/u/alice/flows") {
        return jsonResponse({ flows: [flow] });
      }

      if (url === "/api/u/alice/flows/daily-review/run" && init?.method === "POST") {
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

  it("runs a flow from the inbox Run menu", async () => {
    const onRunFlowComplete = vi.fn();

    render(
      <WorkspaceSessionsSidebar
        slug="alice"
        kind="flows"
        sessions={[]}
        activeSessionId={null}
        hasMoreSessions={false}
        isLoadingMoreSessions={false}
        unseenCompletedSessions={new Set<string>()}
        onCreateSession={vi.fn()}
        onLoadMoreSessions={async () => {}}
        onRunFlowComplete={onRunFlowComplete}
        onSelectSession={vi.fn()}
      />
    );

    fireEvent.pointerDown(await screen.findByRole("button", { name: "Run flow" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByText("Daily review"));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/u/alice/flows/daily-review/run", {
        method: "POST",
      });
    });
    expect(onRunFlowComplete).toHaveBeenCalledTimes(1);
  });
});

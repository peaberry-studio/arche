/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionsPanel } from "@/components/workspace/sessions-panel";
import type { WorkspaceSession } from "@/lib/opencode/types";

afterEach(() => {
  cleanup();
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

    expect(idleRow.querySelector("svg")).toBeNull();
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
});

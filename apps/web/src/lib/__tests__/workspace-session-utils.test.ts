import { describe, expect, it } from "vitest";

import type { WorkspaceSession } from "@/lib/opencode/types";
import {
  canAutoResumeWorkspaceSession,
  getWorkspaceSessionMode,
  getWorkspaceUnreadCounts,
  hasUnseenAutopilotResult,
  isAutopilotSession,
  isBusyAutopilotWorkspaceSession,
} from "@/lib/workspace-session-utils";

const manualSession: WorkspaceSession = {
  id: "manual-session",
  title: "Manual session",
  status: "idle",
  updatedAt: "now",
};

const autopilotSession: WorkspaceSession = {
  id: "task-session",
  title: "Autopilot | Daily brief",
  status: "busy",
  updatedAt: "now",
  autopilot: {
    runId: "run-1",
    taskId: "task-1",
    taskName: "Daily brief",
    trigger: "manual",
    hasUnseenResult: true,
  },
};

describe("workspace session utils", () => {
  it("classifies manual and autopilot sessions", () => {
    expect(isAutopilotSession(manualSession)).toBe(false);
    expect(isAutopilotSession(autopilotSession)).toBe(true);
    expect(getWorkspaceSessionMode(manualSession)).toBe("chat");
    expect(getWorkspaceSessionMode(autopilotSession)).toBe("tasks");
  });

  it("keeps resume ownership and task result state explicit", () => {
    expect(canAutoResumeWorkspaceSession(manualSession)).toBe(true);
    expect(canAutoResumeWorkspaceSession(autopilotSession)).toBe(false);
    expect(isBusyAutopilotWorkspaceSession(autopilotSession)).toBe(true);
    expect(hasUnseenAutopilotResult(autopilotSession)).toBe(true);
  });

  it("derives unread counts without mixing chat and task ownership", () => {
    expect(
      getWorkspaceUnreadCounts(
        [manualSession, autopilotSession],
        new Set(["manual-session", "task-session", "unknown-session"])
      )
    ).toEqual({
      sessionsUnreadCount: 1,
      tasksUnreadCount: 1,
    });
  });
});

import { describe, expect, it } from "vitest";

import type { WorkspaceSession } from "@/lib/opencode/types";
import {
  getWorkspaceSessionMode,
  getWorkspaceUnreadCounts,
  hasUnseenFlowResult,
  isBusyFlowWorkspaceSession,
  isFlowSession,
} from "@/lib/workspace-session-utils";

const manualSession: WorkspaceSession = {
  id: "manual-session",
  title: "Manual session",
  status: "idle",
  updatedAt: "now",
};

const flowSession: WorkspaceSession = {
  id: "flow-session",
  title: "Flow | Daily brief",
  status: "busy",
  updatedAt: "now",
  flow: {
    runId: "run-1",
    flowId: "flow-1",
    flowName: "Daily brief",
    status: "running",
    trigger: "manual",
    hasUnseenResult: true,
  },
};

describe("workspace session utils", () => {
  it("classifies manual and flow sessions", () => {
    expect(isFlowSession(manualSession)).toBe(false);
    expect(isFlowSession(flowSession)).toBe(true);
    expect(getWorkspaceSessionMode(manualSession)).toBe("chat");
    expect(getWorkspaceSessionMode(flowSession)).toBe("flows");
  });

  it("keeps flow result state explicit", () => {
    expect(isBusyFlowWorkspaceSession(flowSession)).toBe(true);
    expect(hasUnseenFlowResult(flowSession)).toBe(true);
  });

  it("derives unread counts without mixing chat and flow ownership", () => {
    expect(
      getWorkspaceUnreadCounts(
        [manualSession, flowSession],
        new Set(["manual-session", "flow-session", "unknown-session"])
      )
    ).toEqual({
      sessionsUnreadCount: 1,
      flowsUnreadCount: 1,
    });
  });
});

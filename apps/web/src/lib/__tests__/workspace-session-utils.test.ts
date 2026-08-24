import { describe, expect, it } from "vitest";

import type { WorkspaceSession } from "@/lib/opencode/types";
import {
  excludeSubagentSessions,
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
  });

  it("keeps flow result state explicit", () => {
    expect(isBusyFlowWorkspaceSession(flowSession)).toBe(true);
    expect(hasUnseenFlowResult(flowSession)).toBe(true);
  });

  it("excludes subagent sessions whose parent is also in the list", () => {
    const childSession: WorkspaceSession = {
      id: "child-session",
      title: "Child session",
      status: "idle",
      updatedAt: "now",
      parentId: manualSession.id,
    };
    const orphanSubagent: WorkspaceSession = {
      id: "orphan-session",
      title: "Orphan session",
      status: "idle",
      updatedAt: "now",
      parentId: "missing-parent",
    };

    expect(
      excludeSubagentSessions([manualSession, flowSession, childSession, orphanSubagent])
    ).toEqual([manualSession, flowSession, orphanSubagent]);
  });
});

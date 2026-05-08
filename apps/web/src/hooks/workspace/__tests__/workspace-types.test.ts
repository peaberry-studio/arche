import { describe, expect, it } from "vitest";

import {
  collectSessionFamilyIds,
  removeWorkspaceSessions,
} from "@/hooks/workspace/workspace-types";
import type { WorkspaceSession } from "@/lib/opencode/types";

function session(
  id: string,
  options: Partial<WorkspaceSession> = {}
): WorkspaceSession {
  return {
    id,
    title: id,
    status: "idle",
    updatedAt: "now",
    ...options,
  };
}

describe("workspace-types session helpers", () => {
  it("removes sessions by id", () => {
    expect(
      removeWorkspaceSessions(
        [session("root"), session("child", { parentId: "root" })],
        new Set(["child"])
      )
    ).toEqual([session("root")]);
  });

  it("collects transitive session family ids", () => {
    expect(
      [...collectSessionFamilyIds(
        [
          session("root"),
          session("child", { parentId: "root" }),
          session("grandchild", { parentId: "child" }),
          session("sibling"),
        ],
        "root"
      )].sort()
    ).toEqual(["child", "grandchild", "root"]);
  });
});

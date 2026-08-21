import { describe, expect, it } from "vitest";

import { getWorkspaceHref } from "@/lib/workspace-hrefs";

describe("getWorkspaceHref", () => {
  it("builds workspace paths with normalized query parameters", () => {
    expect(getWorkspaceHref("alice")).toBe("/w/alice");
    expect(getWorkspaceHref("alice", { mode: "chat" })).toBe("/w/alice");
    expect(getWorkspaceHref("alice", { mode: "explore" })).toBe("/w/alice/explore");
    expect(getWorkspaceHref("alice", { mode: "explore", path: "Notes/Brief.md" })).toBe(
      "/w/alice/explore?path=Notes%2FBrief.md"
    );
    expect(getWorkspaceHref("alice", { mode: "knowledge" })).toBe("/w/alice?mode=knowledge");
    expect(getWorkspaceHref("alice", { mode: "flows", sessionId: "session 1" })).toBe(
      "/w/alice?mode=flows&session=session+1"
    );
    expect(getWorkspaceHref("alice", { settings: "providers" })).toBe("/w/alice?settings=providers");
    expect(getWorkspaceHref("alice", { path: "Notes/Brief.md" })).toBe(
      "/w/alice/explore?path=Notes%2FBrief.md"
    );
  });
});

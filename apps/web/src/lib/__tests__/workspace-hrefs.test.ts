import { describe, expect, it } from "vitest";

import {
  getWorkspaceCatalogHref,
  getWorkspaceFlowsHref,
  getWorkspaceHref,
  getWorkspaceIntegrationHref,
} from "@/lib/workspace-hrefs";

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

describe("getWorkspaceFlowsHref", () => {
  it("builds flows overlay hrefs on the workspace route", () => {
    expect(getWorkspaceFlowsHref("alice", "list")).toBe("/w/alice?flows=list");
    expect(getWorkspaceFlowsHref("alice", "new")).toBe("/w/alice?flows=new");
    expect(getWorkspaceFlowsHref("alice", "edit", "flow-1")).toBe("/w/alice?flows=edit&flowId=flow-1");
    expect(getWorkspaceFlowsHref("alice", "runs", "flow-1")).toBe("/w/alice?flows=runs&flowId=flow-1");
  })

  it("preserves a session query parameter so closing an overlay keeps the chat", () => {
    expect(getWorkspaceFlowsHref("alice", "list", null, "session-1")).toBe(
      "/w/alice?session=session-1&flows=list"
    )
  })
})

describe("getWorkspaceCatalogHref", () => {
  it("builds agents and skills catalog hrefs", () => {
    expect(getWorkspaceCatalogHref("alice", "agents")).toBe("/w/alice?catalog=agents");
    expect(getWorkspaceCatalogHref("alice", "agents", "new")).toBe("/w/alice?catalog=agents&agent=new");
    expect(getWorkspaceCatalogHref("alice", "agents", "helper")).toBe("/w/alice?catalog=agents&agent=helper");
    expect(getWorkspaceCatalogHref("alice", "skills")).toBe("/w/alice?catalog=skills");
    expect(getWorkspaceCatalogHref("alice", "skills", "new")).toBe("/w/alice?catalog=skills&skill=new");
    expect(getWorkspaceCatalogHref("alice", "skills", "writer")).toBe("/w/alice?catalog=skills&skill=writer");
  })
})

describe("getWorkspaceIntegrationHref", () => {
  it("builds integration detail inside the settings modal", () => {
    expect(getWorkspaceIntegrationHref("alice", "slack")).toBe(
      "/w/alice?settings=integrations&integration=slack"
    )
    expect(getWorkspaceIntegrationHref("alice", "mcp")).toBe(
      "/w/alice?settings=integrations&integration=mcp"
    )
  })
})

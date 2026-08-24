import { describe, expect, it } from "vitest";

import {
  collectSessionFamilyIds,
  createDefaultSessionSelectionState,
  filterModelsByProviderStatus,
  findAgentInCatalog,
  getPrimaryAgent,
  getSessionSelectionKey,
  hasModelEntry,
  normalizeAgentId,
  parseModelString,
  resolveModelEntry,
  selectVisiblePermissions,
} from "@/hooks/workspace/workspace-types";
import type { WorkspacePermission } from "@/lib/opencode/permission";
import type { AvailableModel, WorkspaceSession } from "@/lib/opencode/types";

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

const models: AvailableModel[] = [
  {
    providerId: "openai",
    providerName: "OpenAI",
    modelId: "gpt-4.1",
    modelName: "GPT 4.1",
    isDefault: true,
  },
  {
    providerId: "anthropic",
    providerName: "Anthropic",
    modelId: "claude-sonnet",
    modelName: "Claude Sonnet",
    isDefault: false,
  },
  {
    providerId: "opencode",
    providerName: "OpenCode",
    modelId: "zen",
    modelName: "Zen",
    isDefault: false,
  },
  {
    providerId: "custom-provider",
    providerName: "Custom",
    modelId: "custom-model",
    modelName: "Custom Model",
    isDefault: false,
  },
];

describe("workspace-types session helpers", () => {
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

  it("selects visible pending permissions for the active session family", () => {
    const permission = (id: string, sessionId: string): WorkspacePermission => ({
      id,
      sessionId,
      title: `Approve ${id}`,
      state: "pending",
    });
    const permissionsBySession = {
      root: [permission("perm-root", "root")],
      child: [permission("perm-child", "child")],
      grandchild: [permission("perm-grandchild", "grandchild")],
      sibling: [permission("perm-sibling", "sibling")],
    };
    const sessions = [
      session("root"),
      session("child", { parentId: "root" }),
      session("grandchild", { parentId: "child" }),
      session("sibling"),
    ];

    expect(selectVisiblePermissions(permissionsBySession, sessions, "root")).toEqual([
      permissionsBySession.root[0],
      permissionsBySession.child[0],
      permissionsBySession.grandchild[0],
    ]);

    // Another session's family only sees its own permissions.
    expect(selectVisiblePermissions(permissionsBySession, sessions, "sibling")).toEqual([
      permission("perm-sibling", "sibling"),
    ]);

    expect(selectVisiblePermissions(permissionsBySession, sessions, null)).toEqual([]);
  });

  it("filters models and resolves catalog selections", () => {
    expect(filterModelsByProviderStatus(models, [{ providerId: "openai", status: "enabled" }])).toEqual([
      models[0],
      models[2],
      models[3],
    ]);
    expect(parseModelString("openai/gpt-4.1")).toEqual({ providerId: "openai", modelId: "gpt-4.1" });
    expect(parseModelString("openai/")).toBeNull();
    expect(resolveModelEntry("openai", "gpt-4.1", models)).toBe(models[0]);
    expect(resolveModelEntry("missing", "model", models)).toEqual({
      providerId: "missing",
      providerName: "missing",
      modelId: "model",
      modelName: "model",
      isDefault: false,
    });
    expect(hasModelEntry("openai", "gpt-4.1", models)).toBe(true);
    expect(hasModelEntry("openai", "missing", models)).toBe(false);

    const catalog = [
      { id: "primary", displayName: "Primary Agent", isPrimary: true },
      { id: "helper", displayName: "Helper Agent", isPrimary: false },
    ];
    expect(normalizeAgentId(" Helper Agent ")).toBe("helper agent");
    expect(findAgentInCatalog(catalog, "helper")).toBe(catalog[1]);
    expect(findAgentInCatalog(catalog, "helper agent")).toBe(catalog[1]);
    expect(getPrimaryAgent(catalog)).toBe(catalog[0]);
    expect(getPrimaryAgent([])).toBeNull();
  });

  it("handles session selection helpers", () => {
    expect(getSessionSelectionKey(null)).toBe("__pre_session__");
    expect(getSessionSelectionKey("session-1")).toBe("session-1");
    expect(createDefaultSessionSelectionState("primary")).toEqual({
      activeAgentId: "primary",
      manualModel: null,
      runtimeModel: null,
    });
  });
});
